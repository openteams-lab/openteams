use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, OnceLock},
    time::{Duration, Instant},
};

use tokio::sync::watch;

const NPX_MANAGED_ENV: &str = "OPENTEAMS_NPX_MANAGED";
const SESSION_TTL: Duration = Duration::from_secs(30);
const IDLE_SHUTDOWN_GRACE: Duration = Duration::from_secs(15);
const MONITOR_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Default)]
struct BrowserLifecycleState {
    sessions: HashMap<String, Instant>,
    idle_since: Option<Instant>,
    has_seen_session: bool,
}

static STATE: LazyLock<Mutex<BrowserLifecycleState>> =
    LazyLock::new(|| Mutex::new(BrowserLifecycleState::default()));
static SHUTDOWN_CHANNEL: OnceLock<watch::Sender<bool>> = OnceLock::new();

pub fn is_enabled() -> bool {
    std::env::var_os(NPX_MANAGED_ENV).is_some()
}

pub fn note_open(session_id: &str) {
    let mut state = STATE.lock().expect("browser lifecycle state lock poisoned");
    state.has_seen_session = true;
    state.idle_since = None;
    state
        .sessions
        .insert(session_id.to_string(), Instant::now());
}

pub fn note_heartbeat(session_id: &str) {
    let mut state = STATE.lock().expect("browser lifecycle state lock poisoned");
    if !state.has_seen_session {
        state.has_seen_session = true;
    }
    state.idle_since = None;
    state
        .sessions
        .insert(session_id.to_string(), Instant::now());
}

pub fn note_close(session_id: &str) {
    let mut state = STATE.lock().expect("browser lifecycle state lock poisoned");
    state.sessions.remove(session_id);
    if state.has_seen_session && state.sessions.is_empty() {
        state.idle_since = Some(Instant::now());
    }
}

pub fn start_shutdown_monitor() {
    if !is_enabled() {
        return;
    }

    let shutdown_rx = subscribe_shutdown();
    if *shutdown_rx.borrow() {
        return;
    }

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(MONITOR_INTERVAL);
        loop {
            ticker.tick().await;

            if should_request_shutdown() {
                let _ = shutdown_sender().send(true);
                break;
            }

            if shutdown_rx.has_changed().unwrap_or(false) {
                break;
            }
        }
    });
}

pub async fn wait_for_shutdown_signal() {
    let mut rx = subscribe_shutdown();
    if *rx.borrow() {
        return;
    }

    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

fn should_request_shutdown() -> bool {
    let now = Instant::now();
    let mut state = STATE.lock().expect("browser lifecycle state lock poisoned");
    state
        .sessions
        .retain(|_, last_seen| now.duration_since(*last_seen) <= SESSION_TTL);

    if !state.sessions.is_empty() {
        state.idle_since = None;
        return false;
    }

    if !state.has_seen_session {
        return false;
    }

    let idle_since = state.idle_since.get_or_insert(now);
    now.duration_since(*idle_since) >= IDLE_SHUTDOWN_GRACE
}

fn shutdown_sender() -> &'static watch::Sender<bool> {
    SHUTDOWN_CHANNEL.get_or_init(|| {
        let (sender, _receiver) = watch::channel(false);
        sender
    })
}

fn subscribe_shutdown() -> watch::Receiver<bool> {
    shutdown_sender().subscribe()
}

#[cfg(test)]
mod tests {
    use super::{BrowserLifecycleState, IDLE_SHUTDOWN_GRACE, SESSION_TTL, should_request_shutdown};

    #[test]
    fn shutdown_requires_a_seen_session() {
        {
            let mut state = super::STATE
                .lock()
                .expect("browser lifecycle state lock poisoned");
            *state = BrowserLifecycleState::default();
        }

        assert!(!should_request_shutdown());
    }

    #[test]
    fn shutdown_waits_for_idle_grace_after_close() {
        {
            let mut state = super::STATE
                .lock()
                .expect("browser lifecycle state lock poisoned");
            *state = BrowserLifecycleState {
                sessions: Default::default(),
                idle_since: Some(std::time::Instant::now()),
                has_seen_session: true,
            };
        }

        assert!(!should_request_shutdown());

        {
            let mut state = super::STATE
                .lock()
                .expect("browser lifecycle state lock poisoned");
            state.idle_since = Some(std::time::Instant::now() - IDLE_SHUTDOWN_GRACE);
        }

        assert!(should_request_shutdown());
    }

    #[test]
    fn stale_sessions_are_pruned_before_shutdown() {
        {
            let mut state = super::STATE
                .lock()
                .expect("browser lifecycle state lock poisoned");
            *state = BrowserLifecycleState {
                sessions: HashMap::from([(
                    "session-1".to_string(),
                    std::time::Instant::now() - SESSION_TTL - Duration::from_secs(1),
                )]),
                idle_since: Some(std::time::Instant::now() - IDLE_SHUTDOWN_GRACE),
                has_seen_session: true,
            };
        }

        assert!(should_request_shutdown());
    }

    use std::{collections::HashMap, time::Duration};
}
