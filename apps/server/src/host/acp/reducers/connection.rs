use crate::host::acp::types::ConnectionState;

pub fn transition(current: ConnectionState, next: ConnectionState) -> ConnectionState {
    if allowed(current, next) {
        next
    } else {
        current
    }
}

fn allowed(current: ConnectionState, next: ConnectionState) -> bool {
    use ConnectionState::*;
    current == next
        || matches!(
            (current, next),
            (NotStarted, Starting)
                | (Starting, Initializing | Failed | Stopping)
                | (
                    Initializing,
                    AuthenticationRequired | Ready | Failed | Stopping
                )
                | (AuthenticationRequired, Authenticating | Stopping | Failed)
                | (
                    Authenticating,
                    Ready | AuthenticationRequired | Failed | Stopping
                )
                | (Ready | Degraded, Degraded | Restarting | Stopping | Failed)
                | (Restarting, Starting | Failed | Stopping)
                | (Stopping, Stopped | Failed)
                | (Stopped | Failed, Starting)
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_lifecycle_transition() {
        assert_eq!(
            transition(ConnectionState::Starting, ConnectionState::Initializing),
            ConnectionState::Initializing
        );
    }
    #[test]
    fn rejects_invalid_jump_without_mutating_state() {
        assert_eq!(
            transition(ConnectionState::NotStarted, ConnectionState::Ready),
            ConnectionState::NotStarted
        );
    }
}
