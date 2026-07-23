use super::types::{NormalizedEvent, TimelineItem, TimelineItemKind};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

/// Assigns a monotonic sequence at the ACP boundary. Text is coalesced before
/// it reaches the UI; lifecycle and permission events are always emitted.
pub struct EventPipeline {
    sequence: AtomicU64,
    session_id: String,
    turn_id: String,
    text: String,
    emit: Box<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
}

impl EventPipeline {
    pub fn new(
        session_id: String,
        turn_id: String,
        emit: impl Fn(u64, NormalizedEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            sequence: AtomicU64::new(0),
            session_id,
            turn_id,
            text: String::new(),
            emit: Box::new(emit),
        }
    }

    pub fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }

    pub fn flush_text(&mut self) {
        if self.text.is_empty() {
            return;
        }
        let text = std::mem::take(&mut self.text);
        self.emit_timeline(TimelineItemKind::Text, json!({ "text": text }));
    }

    pub fn lifecycle(&mut self, event: NormalizedEvent) {
        self.flush_text();
        self.emit(event);
    }

    pub fn permission(&mut self, payload: Value) {
        self.flush_text();
        self.emit_timeline(TimelineItemKind::Permission, payload);
    }

    pub fn timeline(&mut self, kind: TimelineItemKind, payload: Value) {
        self.flush_text();
        self.emit_timeline(kind, payload);
    }

    fn emit_timeline(&self, kind: TimelineItemKind, payload: Value) {
        self.emit(NormalizedEvent::Timeline(TimelineItem {
            kind,
            id: format!(
                "{}:{}",
                self.turn_id,
                self.sequence.load(Ordering::Relaxed) + 1
            ),
            session_id: self.session_id.clone(),
            turn_id: Some(self.turn_id.clone()),
            payload,
        }));
    }

    fn emit(&self, event: NormalizedEvent) {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        (self.emit)(sequence, event);
    }
}
