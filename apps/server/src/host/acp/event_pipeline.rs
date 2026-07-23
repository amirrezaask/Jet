use super::types::{NormalizedEvent, TimelineItem, TimelineItemKind};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Assigns a monotonic sequence at the ACP boundary. Text is coalesced before
/// it reaches the UI; lifecycle and permission events are always emitted.
pub struct EventPipeline {
    sequence: Arc<AtomicU64>,
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
        Self::with_allocator(session_id, turn_id, Arc::new(AtomicU64::new(0)), emit)
    }

    /// Continue from an existing per-thread/session sequence allocator.
    pub fn with_start(
        session_id: String,
        turn_id: String,
        start_sequence: u64,
        emit: impl Fn(u64, NormalizedEvent) + Send + Sync + 'static,
    ) -> Self {
        Self::with_allocator(
            session_id,
            turn_id,
            Arc::new(AtomicU64::new(start_sequence)),
            emit,
        )
    }

    pub fn with_allocator(
        session_id: String,
        turn_id: String,
        sequence: Arc<AtomicU64>,
        emit: impl Fn(u64, NormalizedEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            sequence,
            session_id,
            turn_id,
            text: String::new(),
            emit: Box::new(emit),
        }
    }

    pub fn current_sequence(&self) -> u64 {
        self.sequence.load(Ordering::Relaxed)
    }

    pub fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }

    pub fn flush_text(&mut self) {
        if self.text.is_empty() {
            return;
        }
        let text = std::mem::take(&mut self.text);
        let id = format!(
            "{}:text:{}",
            self.turn_id,
            self.sequence.load(Ordering::Relaxed) + 1
        );
        self.emit_timeline_with_id(TimelineItemKind::Text, id, json!({ "text": text }));
    }

    pub fn lifecycle(&mut self, event: NormalizedEvent) {
        self.flush_text();
        self.emit(event);
    }

    pub fn permission(&mut self, payload: Value) {
        self.flush_text();
        let id = payload
            .get("id")
            .or_else(|| payload.get("requestId"))
            .and_then(Value::as_str)
            .unwrap_or("permission")
            .to_string();
        self.emit_timeline_with_id(TimelineItemKind::Permission, id, payload);
    }

    pub fn timeline(&mut self, kind: TimelineItemKind, payload: Value) {
        self.flush_text();
        let id = format!(
            "{}:{}",
            self.turn_id,
            self.sequence.load(Ordering::Relaxed) + 1
        );
        self.emit_timeline_with_id(kind, id, payload);
    }

    pub fn timeline_with_id(&mut self, kind: TimelineItemKind, id: String, payload: Value) {
        self.flush_text();
        self.emit_timeline_with_id(kind, id, payload);
    }

    fn emit_timeline_with_id(&self, kind: TimelineItemKind, id: String, payload: Value) {
        self.emit(NormalizedEvent::Timeline(TimelineItem {
            kind,
            id,
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
