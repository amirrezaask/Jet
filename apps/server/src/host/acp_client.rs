//! Retired one-shot ACP client. Use `AcpSupervisor` + `ConnectionPool` instead.
//! This module remains as a thin placeholder so older `use` paths compile out cleanly.

#[allow(dead_code)]
pub fn retired() -> &'static str {
    "use AcpSupervisor"
}
