use agent_client_protocol::schema::v1::{
    CancelNotification, ClientCapabilities, ClientSessionCapabilities, ContentBlock, ContentChunk,
    FileSystemCapabilities, Implementation, InitializeRequest, LoadSessionRequest,
    NewSessionRequest, PermissionOption, PermissionOptionKind, PromptRequest, ReadTextFileRequest,
    ReadTextFileResponse, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionConfigId, SessionConfigKind,
    SessionConfigOption, SessionConfigOptionCategory, SessionConfigOptionValue,
    SessionConfigOptionsCapabilities, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, StopReason, TextContent, ToolCall, ToolCallUpdate,
    WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectTo, ConnectionTo};
use futures_util::future::BoxFuture;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);
const CONFIG_TIMEOUT: Duration = Duration::from_secs(30);
const CANCELLATION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
pub struct AcpTurnInput {
    pub cwd: PathBuf,
    pub prompt: String,
    pub model: Option<String>,
    pub existing_session_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AcpTurnResult {
    pub session_id: String,
    pub text: String,
    pub stop_reason: StopReason,
}

pub fn cursor_acp_agent(binary: impl Into<String>) -> Result<AcpAgent, String> {
    AcpAgent::from_args([binary.into(), "acp".to_string()]).map_err(|error| error.to_string())
}

/// Explicit test-only policy for deterministic mock peers. Production callers
/// must provide a user-mediated permission callback.
pub fn auto_permission_for_tests(options: &[PermissionOption]) -> RequestPermissionOutcome {
    let option = options
        .iter()
        .find(|option| option.kind == PermissionOptionKind::AllowOnce)
        .or_else(|| {
            options
                .iter()
                .find(|option| option.kind == PermissionOptionKind::AllowAlways)
        })
        // Last resort: first option. Reject-only menus still cancel below.
        .or_else(|| {
            options.iter().find(|option| {
                option.kind != PermissionOptionKind::RejectOnce
                    && option.kind != PermissionOptionKind::RejectAlways
            })
        });
    match option {
        Some(option) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
            option.option_id.clone(),
        )),
        None => RequestPermissionOutcome::Cancelled,
    }
}

fn client_capabilities() -> ClientCapabilities {
    // Advertise config-option support so agents expose model selectors and
    // accept `session/set_config_option` for model switches.
    ClientCapabilities::new()
        .session(
            ClientSessionCapabilities::new()
                .config_options(SessionConfigOptionsCapabilities::new()),
        )
        .fs(FileSystemCapabilities::new()
            .read_text_file(true)
            .write_text_file(true))
}

fn model_config_option(options: &[SessionConfigOption]) -> Option<&SessionConfigOption> {
    options
        .iter()
        .find(|option| matches!(option.category, Some(SessionConfigOptionCategory::Model)))
        .or_else(|| {
            options.iter().find(|option| {
                option.id.0.as_ref().eq_ignore_ascii_case("model")
                    || option.name.eq_ignore_ascii_case("model")
            })
        })
}

fn select_has_value(kind: &SessionConfigKind, value: &str) -> bool {
    match kind {
        SessionConfigKind::Select(select) => match &select.options {
            agent_client_protocol::schema::v1::SessionConfigSelectOptions::Ungrouped(options) => {
                options
                    .iter()
                    .any(|option| option.value.0.as_ref() == value)
            }
            agent_client_protocol::schema::v1::SessionConfigSelectOptions::Grouped(groups) => {
                groups
                    .iter()
                    .flat_map(|group| group.options.iter())
                    .any(|option| option.value.0.as_ref() == value)
            }
            _ => false,
        },
        _ => false,
    }
}

async fn apply_session_model(
    connection: &ConnectionTo<Agent>,
    session_id: &agent_client_protocol::schema::v1::SessionId,
    config_options: Option<&[SessionConfigOption]>,
    model: Option<&str>,
) -> Result<(), String> {
    let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let Some(options) = config_options.filter(|items| !items.is_empty()) else {
        return Ok(());
    };
    let Some(option) = model_config_option(options) else {
        return Ok(());
    };
    if matches!(&option.kind, SessionConfigKind::Select(_))
        && !select_has_value(&option.kind, model)
    {
        // Unknown slug — skip rather than fail the turn. Catalog may be ahead of agent.
        return Ok(());
    }
    let request = SetSessionConfigOptionRequest::new(
        session_id.clone(),
        SessionConfigId::new(option.id.0.as_ref()),
        SessionConfigOptionValue::value_id(model.to_string()),
    );
    tokio::time::timeout(
        CONFIG_TIMEOUT,
        connection.send_request(request).block_task(),
    )
    .await
    .map_err(|_| "ACP session/set_config_option timed out".to_string())?
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn tool_activity_label(update: &SessionUpdate) -> Option<String> {
    match update {
        SessionUpdate::ToolCall(ToolCall {
            title,
            kind,
            status,
            ..
        }) => Some(format!("{status:?}: {kind:?} — {title}")),
        SessionUpdate::ToolCallUpdate(ToolCallUpdate { fields, .. }) => {
            let title = fields.title.as_deref().unwrap_or("tool");
            let status = fields
                .status
                .map(|value| format!("{value:?}"))
                .unwrap_or_else(|| "update".to_string());
            Some(format!("Tool {status}: {title}"))
        }
        SessionUpdate::AgentThoughtChunk(_) => Some("Thinking…".to_string()),
        _ => None,
    }
}

pub async fn run_acp_turn<T>(
    transport: T,
    input: AcpTurnInput,
    mut cancel: watch::Receiver<bool>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_permission: Arc<
        dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
            + Send
            + Sync,
    >,
) -> Result<AcpTurnResult, String>
where
    T: ConnectTo<Client> + 'static,
{
    let output = Arc::new(Mutex::new(String::new()));
    let capture_updates = Arc::new(AtomicBool::new(false));
    let fs_handler = crate::host::acp::fs_handler::FsHandler::new(input.cwd.clone())
        .map_err(|error| error.to_string())?;

    Client
        .builder()
        .name("gharargah")
        .on_receive_notification(
            {
                let output = output.clone();
                let capture_updates = capture_updates.clone();
                let on_text = on_text.clone();
                let on_activity = on_activity.clone();
                async move |notification: SessionNotification, _connection| {
                    if !capture_updates.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    if let Some(label) = tool_activity_label(&notification.update) {
                        on_activity(&label);
                    }
                    if let SessionUpdate::AgentMessageChunk(ContentChunk {
                        content: ContentBlock::Text(text),
                        ..
                    }) = notification.update
                    {
                        let snapshot = {
                            let mut output = output.lock().unwrap();
                            output.push_str(&text.text);
                            output.clone()
                        };
                        on_text(&snapshot);
                    }
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            {
                let on_permission = on_permission.clone();
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let outcome = on_permission(request).await;
                    responder.respond(RequestPermissionResponse::new(outcome))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fs_handler = fs_handler.clone();
                async move |request: ReadTextFileRequest, responder, _connection| {
                    let mut content = fs_handler.read_text_file(&request.path)
                        .map_err(|error| agent_client_protocol::util::internal_error(error.to_string()))?;
                    if request.line.is_some() || request.limit.is_some() {
                        let start = request.line.unwrap_or(1).saturating_sub(1) as usize;
                        let limit = request.limit.unwrap_or(u32::MAX) as usize;
                        content = content.lines().skip(start).take(limit).collect::<Vec<_>>().join("\n");
                    }
                    responder.respond(ReadTextFileResponse::new(content))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let fs_handler = fs_handler.clone();
                async move |request: WriteTextFileRequest, responder, _connection| {
                    fs_handler.write_text_file(&request.path, &request.content)
                        .map_err(|error| agent_client_protocol::util::internal_error(error.to_string()))?;
                    responder.respond(WriteTextFileResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, async move |connection| {
            let initialize = InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(client_capabilities())
                .client_info(
                    Implementation::new("gharargah", env!("CARGO_PKG_VERSION")).title("Gharargah"),
                );
            let initialized = tokio::time::timeout(
                HANDSHAKE_TIMEOUT,
                connection.send_request(initialize).block_task(),
            )
            .await
            .map_err(|_| {
                agent_client_protocol::util::internal_error("ACP initialize timed out")
            })??;
            if initialized.protocol_version != ProtocolVersion::V1 {
                return Err(agent_client_protocol::util::internal_error(format!(
                    "unsupported ACP protocol version: {:?}",
                    initialized.protocol_version
                )));
            }

            let (session_id, config_options) = if let Some(existing) = input
                .existing_session_id
                .filter(|_| initialized.agent_capabilities.load_session)
            {
                let request = LoadSessionRequest::new(existing.clone(), input.cwd.clone());
                match tokio::time::timeout(
                    HANDSHAKE_TIMEOUT,
                    connection.send_request(request).block_task(),
                )
                .await
                {
                    Ok(Ok(response)) => (existing.into(), response.config_options),
                    Ok(Err(error)) => {
                        return Err(agent_client_protocol::util::internal_error(format!(
                            "ACP session/load failed: {error}"
                        )));
                    }
                    Err(_) => {
                        return Err(agent_client_protocol::util::internal_error(
                            "ACP session/load timed out",
                        ));
                    }
                }
            } else {
                let response = tokio::time::timeout(
                    HANDSHAKE_TIMEOUT,
                    connection
                        .send_request(NewSessionRequest::new(input.cwd.clone()))
                        .block_task(),
                )
                .await
                .map_err(|_| {
                    agent_client_protocol::util::internal_error("ACP session creation timed out")
                })??;
                (response.session_id, response.config_options)
            };
            on_session(session_id.0.as_ref());

            // Model switch via ACP session config (category=model). Soft-fail so a
            // missing/unsupported option never kills an otherwise healthy turn.
            if let Err(error) = apply_session_model(
                &connection,
                &session_id,
                config_options.as_deref(),
                input.model.as_deref(),
            )
            .await
            {
                on_activity(&format!("Model switch skipped: {error}"));
            }

            capture_updates.store(true, Ordering::Release);

            if *cancel.borrow() {
                capture_updates.store(false, Ordering::Release);
                return Ok(AcpTurnResult {
                    session_id: session_id.0.to_string(),
                    text: output.lock().unwrap().clone(),
                    stop_reason: StopReason::Cancelled,
                });
            }

            let prompt = PromptRequest::new(
                session_id.clone(),
                vec![ContentBlock::Text(TextContent::new(input.prompt))],
            );
            let prompt_request = connection.send_request(prompt).block_task();
            tokio::pin!(prompt_request);
            let mut cancellation_sent = false;
            let cancellation_deadline = tokio::time::sleep(CANCELLATION_TIMEOUT);
            tokio::pin!(cancellation_deadline);
            let response = loop {
                tokio::select! {
                    response = &mut prompt_request => break response.map_err(|error| {
                        agent_client_protocol::util::internal_error(format!(
                            "ACP prompt failed: {error}"
                        ))
                    })?,
                    changed = cancel.changed(), if !cancellation_sent => {
                        if changed.is_err() || *cancel.borrow() {
                            let _ = connection.send_notification(CancelNotification::new(session_id.clone()));
                            cancellation_sent = true;
                            cancellation_deadline.as_mut().reset(
                                tokio::time::Instant::now() + CANCELLATION_TIMEOUT,
                            );
                        }
                    }
                    _ = &mut cancellation_deadline, if cancellation_sent => {
                        return Err(agent_client_protocol::util::internal_error(
                            "provider_unresponsive_after_cancel",
                        ));
                    }
                }
            };
            capture_updates.store(false, Ordering::Release);
            let text = output.lock().unwrap().clone();
            Ok(AcpTurnResult {
                session_id: session_id.0.to_string(),
                text,
                stop_reason: response.stop_reason,
            })
        })
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        AgentCapabilities, InitializeResponse, LoadSessionResponse, NewSessionResponse,
        PermissionOptionId, PromptResponse, SessionConfigSelect, SessionConfigSelectOption,
        SessionConfigSelectOptions, SessionConfigValueId,
    };
    use agent_client_protocol::{Agent, Channel, ConnectionTo, Responder};
    use tokio::sync::Notify;

    #[test]
    fn cursor_launches_the_native_acp_subcommand() {
        let agent = cursor_acp_agent("cursor-agent").unwrap();
        let server = agent.server();
        let json = serde_json::to_value(server).unwrap();
        assert_eq!(json["command"], "cursor-agent");
        assert_eq!(json["args"], serde_json::json!(["acp"]));
    }

    #[test]
    fn permissions_prefer_one_turn_scope_and_never_select_reject() {
        let reject = PermissionOption::new(
            PermissionOptionId::new("reject"),
            "Reject",
            PermissionOptionKind::RejectOnce,
        );
        let allow = PermissionOption::new(
            PermissionOptionId::new("allow"),
            "Allow once",
            PermissionOptionKind::AllowOnce,
        );
        assert!(matches!(
            auto_permission_for_tests(&[reject.clone(), allow]),
            RequestPermissionOutcome::Selected(selected) if selected.option_id.0.as_ref() == "allow"
        ));
        assert_eq!(
            auto_permission_for_tests(&[reject]),
            RequestPermissionOutcome::Cancelled
        );
    }

    #[test]
    fn finds_model_config_by_category() {
        let option = SessionConfigOption::select(
            "model",
            "Model",
            "auto",
            SessionConfigSelectOptions::Ungrouped(vec![SessionConfigSelectOption::new(
                "auto", "Auto",
            )]),
        )
        .category(SessionConfigOptionCategory::Model);
        assert!(model_config_option(std::slice::from_ref(&option)).is_some());
        assert!(select_has_value(
            &SessionConfigKind::Select(SessionConfigSelect::new(
                SessionConfigValueId::new("auto"),
                SessionConfigSelectOptions::Ungrouped(vec![SessionConfigSelectOption::new(
                    "auto", "Auto",
                )]),
            )),
            "auto"
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn negotiates_creates_session_and_streams_text() {
        let (client_transport, agent_transport) = Channel::duplex();
        let agent = Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            _connection| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new()),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            _connection| {
                    responder.respond(NewSessionResponse::new("session-1"))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |request: PromptRequest,
                            responder: Responder<PromptResponse>,
                            connection: ConnectionTo<Client>| {
                    connection.send_notification(SessionNotification::new(
                        request.session_id,
                        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                            TextContent::new("hello from ACP"),
                        ))),
                    ))?;
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                },
                agent_client_protocol::on_receive_request!(),
            );
        tokio::spawn(async move {
            agent.connect_to(agent_transport).await.unwrap();
        });

        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let snapshots = Arc::new(Mutex::new(Vec::<String>::new()));
        let sessions = Arc::new(Mutex::new(Vec::<String>::new()));
        let result = run_acp_turn(
            client_transport,
            AcpTurnInput {
                cwd: std::env::current_dir().unwrap(),
                prompt: "hello".to_string(),
                model: Some("auto".to_string()),
                existing_session_id: None,
            },
            cancel_rx,
            {
                let sessions = sessions.clone();
                Arc::new(move |session_id| sessions.lock().unwrap().push(session_id.to_string()))
            },
            {
                let snapshots = snapshots.clone();
                Arc::new(move |text| snapshots.lock().unwrap().push(text.to_string()))
            },
            Arc::new(|_| {}),
            Arc::new(|request| {
                Box::pin(async move { auto_permission_for_tests(&request.options) })
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.session_id, "session-1");
        assert_eq!(result.text, "hello from ACP");
        assert_eq!(result.stop_reason, StopReason::EndTurn);
        assert_eq!(sessions.lock().unwrap().as_slice(), ["session-1"]);
        assert_eq!(snapshots.lock().unwrap().as_slice(), ["hello from ACP"]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reloads_existing_session_without_replaying_old_output() {
        let (client_transport, agent_transport) = Channel::duplex();
        let agent = Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            _connection| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new().load_session(true)),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |request: LoadSessionRequest,
                            responder: Responder<LoadSessionResponse>,
                            connection: ConnectionTo<Client>| {
                    connection.send_notification(SessionNotification::new(
                        request.session_id,
                        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                            TextContent::new("old replayed output"),
                        ))),
                    ))?;
                    responder.respond(LoadSessionResponse::new())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |request: PromptRequest,
                            responder: Responder<PromptResponse>,
                            connection: ConnectionTo<Client>| {
                    connection.send_notification(SessionNotification::new(
                        request.session_id,
                        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                            TextContent::new("new output"),
                        ))),
                    ))?;
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                },
                agent_client_protocol::on_receive_request!(),
            );
        tokio::spawn(async move {
            agent.connect_to(agent_transport).await.unwrap();
        });

        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let result = run_acp_turn(
            client_transport,
            AcpTurnInput {
                cwd: std::env::current_dir().unwrap(),
                prompt: "continue".to_string(),
                model: None,
                existing_session_id: Some("session-existing".to_string()),
            },
            cancel_rx,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|request| {
                Box::pin(async move { auto_permission_for_tests(&request.options) })
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.session_id, "session-existing");
        assert_eq!(result.text, "new output");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sets_model_via_session_config_option() {
        let (client_transport, agent_transport) = Channel::duplex();
        let model_seen = Arc::new(Mutex::new(None::<String>));
        let agent = Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            _connection| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new()),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            _connection| {
                    let option = SessionConfigOption::select(
                        "model",
                        "Model",
                        "auto",
                        vec![
                            SessionConfigSelectOption::new("auto", "Auto"),
                            SessionConfigSelectOption::new("composer-2.5", "Composer 2.5"),
                        ],
                    )
                    .category(SessionConfigOptionCategory::Model);
                    responder.respond(
                        NewSessionResponse::new("session-model").config_options(vec![option]),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                {
                    let model_seen = model_seen.clone();
                    async move |request: SetSessionConfigOptionRequest,
                                responder: Responder<
                        agent_client_protocol::schema::v1::SetSessionConfigOptionResponse,
                    >,
                                _connection| {
                        if let Some(value) = request.value.as_value_id() {
                            *model_seen.lock().unwrap() = Some(value.0.to_string());
                        }
                        responder.respond(
                            agent_client_protocol::schema::v1::SetSessionConfigOptionResponse::new(
                                vec![],
                            ),
                        )
                    }
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: PromptRequest,
                            responder: Responder<PromptResponse>,
                            _connection| {
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                },
                agent_client_protocol::on_receive_request!(),
            );
        tokio::spawn(async move {
            agent.connect_to(agent_transport).await.unwrap();
        });

        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let result = run_acp_turn(
            client_transport,
            AcpTurnInput {
                cwd: std::env::current_dir().unwrap(),
                prompt: "hi".to_string(),
                model: Some("composer-2.5".to_string()),
                existing_session_id: None,
            },
            cancel_rx,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|request| {
                Box::pin(async move { auto_permission_for_tests(&request.options) })
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.session_id, "session-model");
        assert_eq!(model_seen.lock().unwrap().as_deref(), Some("composer-2.5"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn forwards_turn_cancellation_to_the_agent() {
        let (client_transport, agent_transport) = Channel::duplex();
        let prompt_started = Arc::new(Notify::new());
        let cancellation_received = Arc::new(Notify::new());
        let cancellation_observed = Arc::new(AtomicBool::new(false));
        let agent = Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest,
                            responder: Responder<InitializeResponse>,
                            _connection| {
                    responder.respond(
                        InitializeResponse::new(request.protocol_version)
                            .agent_capabilities(AgentCapabilities::new()),
                    )
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            _connection| {
                    responder.respond(NewSessionResponse::new("session-cancel"))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_notification(
                {
                    let cancellation_received = cancellation_received.clone();
                    let cancellation_observed = cancellation_observed.clone();
                    async move |_notification: CancelNotification, _connection| {
                        cancellation_observed.store(true, Ordering::Release);
                        cancellation_received.notify_one();
                        Ok(())
                    }
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                {
                    let prompt_started = prompt_started.clone();
                    let cancellation_received = cancellation_received.clone();
                    async move |_request: PromptRequest,
                                responder: Responder<PromptResponse>,
                                connection: ConnectionTo<Client>| {
                        let prompt_started = prompt_started.clone();
                        let cancellation_received = cancellation_received.clone();
                        prompt_started.notify_one();
                        connection.spawn(async move {
                            cancellation_received.notified().await;
                            responder.respond(PromptResponse::new(StopReason::Cancelled))
                        })?;
                        Ok(())
                    }
                },
                agent_client_protocol::on_receive_request!(),
            );
        tokio::spawn(async move {
            agent.connect_to(agent_transport).await.unwrap();
        });

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let turn = tokio::spawn(run_acp_turn(
            client_transport,
            AcpTurnInput {
                cwd: std::env::current_dir().unwrap(),
                prompt: "cancel me".to_string(),
                model: None,
                existing_session_id: None,
            },
            cancel_rx,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            Arc::new(|request| {
                Box::pin(async move { auto_permission_for_tests(&request.options) })
            }),
        ));
        prompt_started.notified().await;
        cancel_tx.send(true).unwrap();

        let result = turn.await.unwrap().unwrap();
        assert_eq!(result.session_id, "session-cancel");
        assert_eq!(result.stop_reason, StopReason::Cancelled);
        assert!(cancellation_observed.load(Ordering::Acquire));
    }
}
