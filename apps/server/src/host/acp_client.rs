use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, ContentChunk, Implementation, InitializeRequest,
    LoadSessionRequest, NewSessionRequest, PermissionOption, PermissionOptionKind, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, StopReason, TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Client, ConnectTo};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CANCELLATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug)]
pub struct AcpTurnInput {
    pub cwd: PathBuf,
    pub prompt: String,
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

fn preferred_permission(options: &[PermissionOption]) -> RequestPermissionOutcome {
    let option = options
        .iter()
        .find(|option| option.kind == PermissionOptionKind::AllowOnce)
        .or_else(|| {
            options
                .iter()
                .find(|option| option.kind == PermissionOptionKind::AllowAlways)
        });
    match option {
        Some(option) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
            option.option_id.clone(),
        )),
        None => RequestPermissionOutcome::Cancelled,
    }
}

pub async fn run_acp_turn<T>(
    transport: T,
    input: AcpTurnInput,
    mut cancel: watch::Receiver<bool>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
) -> Result<AcpTurnResult, String>
where
    T: ConnectTo<Client> + 'static,
{
    let output = Arc::new(Mutex::new(String::new()));
    let capture_updates = Arc::new(AtomicBool::new(false));

    Client
        .builder()
        .name("gharargah")
        .on_receive_notification(
            {
                let output = output.clone();
                let capture_updates = capture_updates.clone();
                let on_text = on_text.clone();
                async move |notification: SessionNotification, _connection| {
                    if !capture_updates.load(Ordering::Acquire) {
                        return Ok(());
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
            async move |request: RequestPermissionRequest, responder, _connection| {
                responder.respond(RequestPermissionResponse::new(preferred_permission(
                    &request.options,
                )))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, async move |connection| {
            let initialize = InitializeRequest::new(ProtocolVersion::V1).client_info(
                Implementation::new("gharargah", env!("CARGO_PKG_VERSION")).title("Gharargah"),
            );
            let initialized = tokio::time::timeout(
                REQUEST_TIMEOUT,
                connection.send_request(initialize).block_task(),
            )
            .await
            .map_err(|_| agent_client_protocol::util::internal_error("ACP initialize timed out"))??;
            if initialized.protocol_version != ProtocolVersion::V1 {
                return Err(agent_client_protocol::util::internal_error(format!(
                    "unsupported ACP protocol version: {:?}",
                    initialized.protocol_version
                )));
            }

            let session_id = if let Some(existing) = input
                .existing_session_id
                .filter(|_| initialized.agent_capabilities.load_session)
            {
                let request = LoadSessionRequest::new(existing.clone(), input.cwd.clone());
                match tokio::time::timeout(
                    REQUEST_TIMEOUT,
                    connection.send_request(request).block_task(),
                )
                .await
                {
                    Ok(Ok(_)) => existing.into(),
                    _ => tokio::time::timeout(
                        REQUEST_TIMEOUT,
                        connection
                            .send_request(NewSessionRequest::new(input.cwd.clone()))
                            .block_task(),
                    )
                    .await
                    .map_err(|_| {
                        agent_client_protocol::util::internal_error(
                            "ACP session creation timed out",
                        )
                    })??
                    .session_id,
                }
            } else {
                tokio::time::timeout(
                    REQUEST_TIMEOUT,
                    connection
                        .send_request(NewSessionRequest::new(input.cwd.clone()))
                        .block_task(),
                )
                .await
                .map_err(|_| {
                    agent_client_protocol::util::internal_error("ACP session creation timed out")
                })??
                .session_id
            };
            on_session(session_id.0.as_ref());
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
                    response = &mut prompt_request => break response?,
                    changed = cancel.changed(), if !cancellation_sent => {
                        if changed.is_err() || *cancel.borrow() {
                            connection.send_notification(CancelNotification::new(session_id.clone()))?;
                            cancellation_sent = true;
                            cancellation_deadline.as_mut().reset(
                                tokio::time::Instant::now() + CANCELLATION_TIMEOUT,
                            );
                        }
                    }
                    _ = &mut cancellation_deadline, if cancellation_sent => {
                        break agent_client_protocol::schema::v1::PromptResponse::new(
                            StopReason::Cancelled,
                        );
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
        PermissionOptionId, PromptResponse,
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
            preferred_permission(&[reject.clone(), allow]),
            RequestPermissionOutcome::Selected(selected) if selected.option_id.0.as_ref() == "allow"
        ));
        assert_eq!(
            preferred_permission(&[reject]),
            RequestPermissionOutcome::Cancelled
        );
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
                existing_session_id: Some("session-existing".to_string()),
            },
            cancel_rx,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        )
        .await
        .unwrap();
        assert_eq!(result.session_id, "session-existing");
        assert_eq!(result.text, "new output");
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
                existing_session_id: None,
            },
            cancel_rx,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        ));
        prompt_started.notified().await;
        cancel_tx.send(true).unwrap();

        let result = turn.await.unwrap().unwrap();
        assert_eq!(result.session_id, "session-cancel");
        assert_eq!(result.stop_reason, StopReason::Cancelled);
        assert!(cancellation_observed.load(Ordering::Acquire));
    }
}
