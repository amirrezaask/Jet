use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEvent {
    pub protocol_version: u32,
    pub sequence: u64,
    pub channel: String,
    pub args: Vec<Value>,
}

#[derive(Clone)]
pub struct EventHub {
    sender: broadcast::Sender<HostEvent>,
    sequence: Arc<AtomicU64>,
    history: Arc<Mutex<VecDeque<HostEvent>>>,
    capacity: usize,
}

impl EventHub {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            sender,
            sequence: Arc::new(AtomicU64::new(0)),
            history: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            capacity,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HostEvent> {
        self.sender.subscribe()
    }

    pub fn emit(&self, channel: &str, args: Vec<Value>) {
        let event = HostEvent {
            protocol_version: 1,
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed) + 1,
            channel: channel.to_string(),
            args,
        };
        let mut history = self.history.lock().unwrap();
        history.push_back(event.clone());
        while history.len() > self.capacity {
            history.pop_front();
        }
        drop(history);
        let _ = self.sender.send(event);
    }

    pub fn replay_after(&self, sequence: u64) -> Vec<HostEvent> {
        self.history
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.sequence > sequence)
            .cloned()
            .collect()
    }
}

pub fn emit_host(events: &EventHub, channel: &str, args: Vec<Value>) {
    events.emit(channel, args);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn events_are_sequenced_and_broadcast() {
        let hub = EventHub::new(4);
        let mut rx = hub.subscribe();
        hub.emit("test", vec![Value::Bool(true)]);
        let event = rx.recv().await.unwrap();
        assert_eq!(event.sequence, 1);
        assert_eq!(event.protocol_version, 1);
        assert_eq!(event.channel, "test");
    }
}
