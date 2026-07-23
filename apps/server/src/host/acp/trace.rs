use super::bounds::{MAX_TRACE_ENTRIES, MAX_TRACE_ENTRY_BYTES};
use super::redaction::{redact_json, redact_string};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum TraceDirection {
    Inbound,
    Outbound,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TraceEntry {
    pub timestamp_ms: u64,
    pub direction: TraceDirection,
    pub message: Value,
}

#[derive(Clone, Debug)]
pub struct ProtocolTrace {
    capacity: usize,
    entries: VecDeque<TraceEntry>,
}

impl Default for ProtocolTrace {
    fn default() -> Self {
        Self::new(MAX_TRACE_ENTRIES)
    }
}

impl ProtocolTrace {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.min(MAX_TRACE_ENTRIES),
            entries: VecDeque::new(),
        }
    }

    pub fn record(&mut self, timestamp_ms: u64, direction: TraceDirection, message: &Value) {
        if self.capacity == 0 {
            return;
        }
        let mut message = redact_json(message);
        let serialized =
            serde_json::to_string(&message).unwrap_or_else(|_| "\"[UNSERIALIZABLE]\"".to_string());
        if serialized.len() > MAX_TRACE_ENTRY_BYTES {
            let boundary = serialized
                .char_indices()
                .take_while(|(index, _)| *index < MAX_TRACE_ENTRY_BYTES)
                .last()
                .map(|(index, character)| index + character.len_utf8())
                .unwrap_or(0);
            message = Value::String(format!(
                "{}…[TRUNCATED]",
                redact_string(&serialized[..boundary])
            ));
        }
        if self.entries.len() == self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(TraceEntry {
            timestamp_ms,
            direction,
            message,
        });
    }

    pub fn entries(&self) -> impl ExactSizeIterator<Item = &TraceEntry> {
        self.entries.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn trace_is_bounded_and_redacted() {
        let mut trace = ProtocolTrace::new(2);
        trace.record(
            1,
            TraceDirection::Inbound,
            &json!({"Authorization": "Bearer secret"}),
        );
        trace.record(2, TraceDirection::Inbound, &json!(2));
        trace.record(3, TraceDirection::Outbound, &json!(3));
        assert_eq!(trace.entries().len(), 2);
        assert_eq!(trace.entries().next().expect("entry").message, json!(2));
    }
}
