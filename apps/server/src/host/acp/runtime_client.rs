use crate::host::acp_client::{run_acp_turn, AcpTurnInput, AcpTurnResult};
use agent_client_protocol::schema::v1::{RequestPermissionOutcome, RequestPermissionRequest};
use agent_client_protocol::AcpAgent;
use futures_util::future::BoxFuture;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;

/// ACP process transport owned by the supervisor. The API intentionally keeps
/// turn callbacks at this boundary so the host never has to create a runtime.
pub struct RuntimeClient {
    transport: AcpAgent,
}

impl RuntimeClient {
    pub fn from_command(command: impl Into<String>, args: Vec<String>) -> Result<Self, String> {
        let mut argv = vec![command.into()];
        argv.extend(args);
        Ok(Self {
            transport: AcpAgent::from_args(argv).map_err(|error| error.to_string())?,
        })
    }

    pub async fn run_turn(
        self,
        cwd: PathBuf,
        prompt: String,
        model: Option<String>,
        existing_session_id: Option<String>,
        cancel: watch::Receiver<bool>,
        on_session: Arc<dyn Fn(&str) + Send + Sync>,
        on_text: Arc<dyn Fn(&str) + Send + Sync>,
        on_activity: Arc<dyn Fn(&str) + Send + Sync>,
        on_permission: Arc<
            dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
                + Send
                + Sync,
        >,
    ) -> Result<AcpTurnResult, String> {
        run_acp_turn(
            self.transport,
            AcpTurnInput {
                cwd,
                prompt,
                model,
                existing_session_id,
            },
            cancel,
            on_session,
            on_text,
            on_activity,
            on_permission,
        )
        .await
    }
}
