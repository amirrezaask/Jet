pub mod cli;
pub mod scenarios;

pub use scenarios::Scenario;

use agent_client_protocol::schema::v1::{
    AgentAuthCapabilities, AgentCapabilities, AuthenticateRequest, AuthenticateResponse,
    AuthMethod, AuthMethodAgent, AvailableCommand, AvailableCommandsUpdate, CancelNotification,
    CloseSessionRequest, CloseSessionResponse, ContentBlock, ContentChunk, CreateTerminalRequest,
    DeleteSessionRequest, DeleteSessionResponse, Implementation, InitializeRequest,
    InitializeResponse, ListSessionsRequest, ListSessionsResponse, LoadSessionRequest,
    LoadSessionResponse, LogoutCapabilities, LogoutRequest, LogoutResponse, NewSessionRequest,
    NewSessionResponse, PermissionOption, PermissionOptionKind, Plan, PlanEntry, PlanEntryPriority,
    PlanEntryStatus, PromptRequest, PromptResponse, ReadTextFileRequest, ReleaseTerminalRequest,
    RequestPermissionOutcome, RequestPermissionRequest, ResumeSessionRequest, ResumeSessionResponse,
    SessionCapabilities, SessionCloseCapabilities, SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigSelectOption, SessionConfigSelectOptions, SessionDeleteCapabilities, SessionInfo,
    SessionListCapabilities, SessionNotification, SessionResumeCapabilities, SessionUpdate,
    SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, StopReason, TerminalOutputRequest,
    TextContent, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UsageUpdate, WaitForTerminalExitRequest,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{Agent, Client, ConnectionTo, Result, Stdio};
use anyhow::{bail, Context};
use cli::Args;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Default)]
struct SessionState {
    cancelled: AtomicBool,
    cancel_notify: Notify,
}

struct MockState {
    args: Args,
    scenario: Scenario,
    sessions: Mutex<HashMap<String, Arc<SessionState>>>,
    next_session: AtomicU64,
    prompt_count: AtomicU64,
    random: Mutex<u64>,
}

impl MockState {
    fn new(args: Args, scenario: Scenario) -> Self {
        Self {
            random: Mutex::new(args.seed),
            args,
            scenario,
            sessions: Mutex::new(HashMap::new()),
            next_session: AtomicU64::new(1),
            prompt_count: AtomicU64::new(0),
        }
    }

    fn new_session(&self) -> String {
        let id = format!(
            "mock-session-{}",
            self.next_session.fetch_add(1, Ordering::Relaxed)
        );
        self.session(&id);
        id
    }

    fn session(&self, id: &str) -> Arc<SessionState> {
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        sessions
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(SessionState::default()))
            .clone()
    }

    fn delay(&self) -> Duration {
        let jitter = if self.args.jitter_ms == 0 {
            0
        } else {
            let mut value = self.random.lock().expect("random state poisoned");
            *value = value.wrapping_mul(6364136223846793005).wrapping_add(1);
            *value % (self.args.jitter_ms + 1)
        };
        Duration::from_millis(self.args.latency_ms + jitter)
    }

    async fn wait(&self) {
        let delay = self.delay();
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }

    fn supports_load_session(&self) -> bool {
        self.scenario == Scenario::LoadSession
            || self
                .args
                .capabilities
                .as_deref()
                .is_some_and(|value| value.split(',').any(|item| item.trim() == "load_session"))
    }

    fn supports_resume_session(&self) -> bool {
        self.scenario == Scenario::LoadSession
            || self
                .args
                .capabilities
                .as_deref()
                .is_some_and(|value| value.split(',').any(|item| item.trim() == "resume"))
    }

    fn requires_auth(&self) -> bool {
        self.args
            .capabilities
            .as_deref()
            .is_some_and(|value| value.split(',').any(|item| item.trim() == "auth"))
    }
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    let scenario = match Scenario::parse(&args.scenario) {
        Some(scenario) => scenario,
        None if !args.strict => {
            eprintln!(
                "mock-acp: unknown scenario {:?}; falling back to echo",
                args.scenario
            );
            Scenario::Echo
        }
        None => {
            bail!(
                "unknown scenario {:?}; available: {}",
                args.scenario,
                Scenario::ALL
                    .iter()
                    .map(|(name, _)| *name)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    };
    for line in 0..args.stderr_noise {
        eprintln!("mock-acp stderr noise {line}");
    }
    let state = Arc::new(MockState::new(args, scenario));
    let trace = state.args.trace;

    Agent
        .builder()
        .name("gharargah-mock-acp")
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: InitializeRequest, responder, _connection| {
                    if state.args.strict && request.protocol_version != ProtocolVersion::V1 {
                        return Err(agent_client_protocol::util::internal_error(
                            "gharargah-mock-acp supports ACP protocol V1 only",
                        ));
                    }
                    let mut capabilities =
                        AgentCapabilities::new().load_session(state.supports_load_session());
                    if state.supports_resume_session() || state.supports_load_session() {
                        capabilities = capabilities.session_capabilities(
                            SessionCapabilities::new()
                                .list(SessionListCapabilities::new())
                                .resume(SessionResumeCapabilities::new())
                                .close(SessionCloseCapabilities::new())
                                .delete(SessionDeleteCapabilities::new()),
                        );
                    }
                    if state.requires_auth() {
                        capabilities = capabilities
                            .auth(AgentAuthCapabilities::new().logout(LogoutCapabilities::new()));
                    }
                    let mut response = InitializeResponse::new(ProtocolVersion::V1)
                        .agent_capabilities(capabilities)
                        .agent_info(Implementation::new("gharargah-mock-acp", "0.1").title(
                            format!("Gharargah Mock ACP ({})", state.args.provider_profile),
                        ));
                    if state.requires_auth() {
                        response = response.auth_methods(vec![AuthMethod::Agent(
                            AuthMethodAgent::new("mock-token", "Mock token auth"),
                        )]);
                    }
                    responder.respond(response)?;
                    if state.scenario == Scenario::ChaosMalformed
                        || state.args.fault.as_deref() == Some("malformed")
                    {
                        // Intentional protocol fault used by transport error tests.
                        let mut stdout = std::io::stdout().lock();
                        writeln!(stdout, "{{ this is intentionally malformed json")
                            .map_err(anyhow::Error::from)?;
                        stdout.flush().map_err(anyhow::Error::from)?;
                    }
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |_request: NewSessionRequest, responder, _connection| {
                    let session_id = state.new_session();
                    let response = if state.scenario == Scenario::ConfigModel {
                        NewSessionResponse::new(session_id).config_options(model_options())
                    } else {
                        NewSessionResponse::new(session_id)
                    };
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: LoadSessionRequest,
                            responder,
                            connection: ConnectionTo<Client>| {
                    state.session(request.session_id.0.as_ref());
                    if state.scenario == Scenario::LoadSession {
                        send_update(
                            &connection,
                            request.session_id.clone(),
                            SessionUpdate::AgentMessageChunk(text_chunk(
                                "Mock replayed session message.",
                            )),
                        )?;
                    }
                    responder.respond(LoadSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: ResumeSessionRequest, responder, _connection| {
                    state.session(request.session_id.0.as_ref());
                    // Resume restores context without replaying history.
                    responder.respond(ResumeSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: AuthenticateRequest, responder, _connection| {
                if request.method_id.0.as_ref() != "mock-token" {
                    return Err(agent_client_protocol::util::internal_error(
                        "unknown auth method",
                    ));
                }
                responder.respond(AuthenticateResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |_request: LogoutRequest, responder, _connection| {
                responder.respond(LogoutResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |_request: ListSessionsRequest, responder, _connection| {
                    let sessions = state
                        .sessions
                        .lock()
                        .expect("sessions")
                        .keys()
                        .map(|id| SessionInfo::new(id.clone(), std::env::current_dir().unwrap_or_default()))
                        .collect();
                    responder.respond(ListSessionsResponse::new(sessions))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: CloseSessionRequest, responder, _connection| {
                    state
                        .sessions
                        .lock()
                        .expect("sessions")
                        .remove(request.session_id.0.as_ref());
                    responder.respond(CloseSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: DeleteSessionRequest, responder, _connection| {
                    state
                        .sessions
                        .lock()
                        .expect("sessions")
                        .remove(request.session_id.0.as_ref());
                    responder.respond(DeleteSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |_request: SetSessionConfigOptionRequest, responder, _connection| {
                responder.respond(SetSessionConfigOptionResponse::new(Vec::new()))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            {
                let state = state.clone();
                async move |notification: CancelNotification, _connection| {
                    let session = state.session(notification.session_id.0.as_ref());
                    session.cancelled.store(true, Ordering::Release);
                    session.cancel_notify.notify_waiters();
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            {
                let state = state.clone();
                async move |request: PromptRequest, responder, connection: ConnectionTo<Client>| {
                    let state = state.clone();
                    let prompt_connection = connection.clone();
                    connection.spawn(async move {
                        let response = handle_prompt(state, request, prompt_connection).await;
                        responder.respond(response?)
                    })?;
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_to(if trace {
            Stdio::new().with_debug(|line, direction| eprintln!("[mock-acp {direction:?}] {line}"))
        } else {
            Stdio::new()
        })
        .await
        .context("ACP stdio connection failed")
}

async fn handle_prompt(
    state: Arc<MockState>,
    request: PromptRequest,
    connection: ConnectionTo<Client>,
) -> Result<PromptResponse> {
    let session = state.session(request.session_id.0.as_ref());
    session.cancelled.store(false, Ordering::Release);
    let prompt = prompt_text(&request);
    let prompt_number = state.prompt_count.fetch_add(1, Ordering::Relaxed) + 1;

    let stop_reason = match state.scenario {
        Scenario::ThoughtThenAnswer => {
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::AgentThoughtChunk(text_chunk(
                    "Mock thought: considering the prompt.",
                )),
            )?;
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
        Scenario::ToolLifecycle => {
            let tool_id = format!("tool-{prompt_number}");
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::ToolCall(
                    ToolCall::new(tool_id.clone(), "Mock tool")
                        .kind(ToolKind::Execute)
                        .status(ToolCallStatus::Pending),
                ),
            )?;
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    tool_id.clone(),
                    ToolCallUpdateFields::new().status(ToolCallStatus::InProgress),
                )),
            )?;
            state.wait().await;
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    tool_id,
                    ToolCallUpdateFields::new().status(ToolCallStatus::Completed),
                )),
            )?;
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
        Scenario::PermissionAllow | Scenario::PermissionToolRace => {
            let tool_id = format!("permission-tool-{prompt_number}");
            let tool = ToolCallUpdate::new(
                tool_id,
                ToolCallUpdateFields::new()
                    .title("Mock protected operation".to_string())
                    .kind(ToolKind::Execute)
                    .status(ToolCallStatus::InProgress),
            );
            // The update is sent before awaiting the request response. Both messages are
            // queued in one turn without a client round trip, reproducing the race.
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::ToolCallUpdate(tool.clone()),
            )?;
            let permission = RequestPermissionRequest::new(
                request.session_id.clone(),
                tool,
                vec![
                    PermissionOption::new(
                        "allow_once",
                        "Allow once",
                        PermissionOptionKind::AllowOnce,
                    ),
                    PermissionOption::new(
                        "reject_once",
                        "Reject once",
                        PermissionOptionKind::RejectOnce,
                    ),
                ],
            );
            let response = connection.send_request(permission).block_task().await?;
            match response.outcome {
                RequestPermissionOutcome::Selected(selected)
                    if selected.option_id.0.as_ref() == "allow_once" =>
                {
                    answer(&state, &connection, &request.session_id, &prompt).await?
                }
                _ => StopReason::Refusal,
            }
        }
        Scenario::PlanUpdate => {
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::Plan(Plan::new(vec![
                    PlanEntry::new(
                        "Inspect mock prompt",
                        PlanEntryPriority::High,
                        PlanEntryStatus::Completed,
                    ),
                    PlanEntry::new(
                        "Return deterministic answer",
                        PlanEntryPriority::Medium,
                        PlanEntryStatus::InProgress,
                    ),
                ])),
            )?;
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
        Scenario::CancelCoop => {
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::AgentThoughtChunk(text_chunk("Mock cancellation waiting.")),
            )?;
            tokio::select! {
                _ = session.cancel_notify.notified() => StopReason::Cancelled,
                _ = tokio::time::sleep(Duration::from_secs(60)) => {
                    answer(&state, &connection, &request.session_id, &prompt).await?
                }
            }
        }
        Scenario::SlowStream => {
            let text = format!("Mock agent reply: {prompt}");
            for part in chunks(&text, state.args.chunk_size) {
                if session.cancelled.load(Ordering::Acquire) {
                    break;
                }
                send_update(
                    &connection,
                    request.session_id.clone(),
                    SessionUpdate::AgentMessageChunk(text_chunk(part)),
                )?;
                state.wait().await;
            }
            if session.cancelled.load(Ordering::Acquire) {
                StopReason::Cancelled
            } else {
                StopReason::EndTurn
            }
        }
        Scenario::UsageMeter => {
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::UsageUpdate(UsageUpdate::new(128, 4_096)),
            )?;
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
        Scenario::SlashCommands => {
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![
                    AvailableCommand::new("/mock", "Run the mock agent"),
                    AvailableCommand::new("/reset", "Reset mock state"),
                ])),
            )?;
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
        Scenario::FsRoundtrip => {
            let path = PathBuf::from(&prompt);
            let content = connection
                .send_request(ReadTextFileRequest::new(request.session_id.clone(), path))
                .block_task()
                .await?
                .content;
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::AgentMessageChunk(text_chunk(format!("Mock read: {content}"))),
            )?;
            StopReason::EndTurn
        }
        Scenario::TerminalRoundtrip => {
            let created = connection
                .send_request(
                    CreateTerminalRequest::new(request.session_id.clone(), "/bin/echo")
                        .args(vec!["hi".to_string()]),
                )
                .block_task()
                .await?;
            let _exit = connection
                .send_request(WaitForTerminalExitRequest::new(
                    request.session_id.clone(),
                    created.terminal_id.clone(),
                ))
                .block_task()
                .await?;
            let output = connection
                .send_request(TerminalOutputRequest::new(
                    request.session_id.clone(),
                    created.terminal_id.clone(),
                ))
                .block_task()
                .await?;
            connection
                .send_request(ReleaseTerminalRequest::new(
                    request.session_id.clone(),
                    created.terminal_id,
                ))
                .block_task()
                .await?;
            send_update(
                &connection,
                request.session_id.clone(),
                SessionUpdate::AgentMessageChunk(text_chunk(format!(
                    "Mock terminal: {}",
                    output.output.trim()
                ))),
            )?;
            StopReason::EndTurn
        }
        Scenario::ChaosMalformed => {
            // Initialize already injected a malformed JSON line; fail the prompt so
            // clients observe a hard transport/protocol error rather than a silent echo.
            return Err(agent_client_protocol::util::internal_error(
                "chaos_malformed: intentional protocol/prompt failure",
            ));
        }
        Scenario::Echo
        | Scenario::ConfigModel
        | Scenario::LoadSession
        | Scenario::MultiSession => {
            answer(&state, &connection, &request.session_id, &prompt).await?
        }
    };

    if state.args.exit_after != 0 && prompt_number >= state.args.exit_after {
        // Closing stdio after the response is deliberate: it lets process-exit handling
        // be tested without corrupting the current turn.
        connection.spawn(async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            std::process::exit(0)
        })?;
    }
    Ok(PromptResponse::new(stop_reason))
}

async fn answer(
    state: &MockState,
    connection: &ConnectionTo<Client>,
    session_id: &agent_client_protocol::schema::v1::SessionId,
    prompt: &str,
) -> Result<StopReason> {
    if state.args.fault.as_deref() == Some("disconnect") {
        return Err(agent_client_protocol::util::internal_error(
            "mock disconnect fault",
        ));
    }
    state.wait().await;
    send_update(
        connection,
        session_id.clone(),
        SessionUpdate::AgentMessageChunk(text_chunk(format!("Mock agent reply: {prompt}"))),
    )?;
    Ok(StopReason::EndTurn)
}

fn send_update(
    connection: &ConnectionTo<Client>,
    session_id: agent_client_protocol::schema::v1::SessionId,
    update: SessionUpdate,
) -> Result<()> {
    connection.send_notification(SessionNotification::new(session_id, update))
}

fn text_chunk(text: impl Into<String>) -> ContentChunk {
    ContentChunk::new(ContentBlock::Text(TextContent::new(text)))
}

fn prompt_text(request: &PromptRequest) -> String {
    request
        .prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn chunks(text: &str, size: usize) -> Vec<&str> {
    let size = size.max(1);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + size).min(text.len());
        while end < text.len() && !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            end = text[start..]
                .chars()
                .next()
                .map_or(text.len(), |character| start + character.len_utf8());
        }
        chunks.push(&text[start..end]);
        start = end;
    }
    chunks
}

fn model_options() -> Vec<SessionConfigOption> {
    vec![SessionConfigOption::select(
        "model",
        "Model",
        "mock-auto",
        SessionConfigSelectOptions::Ungrouped(vec![
            SessionConfigSelectOption::new("mock-auto", "Mock Auto"),
            SessionConfigSelectOption::new("mock-fast", "Mock Fast"),
        ]),
    )
    .category(SessionConfigOptionCategory::Model)]
}

#[cfg(test)]
mod tests {
    use super::chunks;

    #[test]
    fn chunks_preserve_utf8() {
        assert_eq!(chunks("aébc", 2), vec!["a", "é", "bc"]);
    }
}
