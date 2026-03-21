use std::{io, process::ExitStatus};

use command_group::AsyncGroupChild;
#[cfg(unix)]
use nix::{
    sys::signal::{Signal, killpg},
    unistd::{Pid, getpgid},
};
use tokio::time::Duration;

const FORCE_KILL_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct ProcessCleanupResult {
    pub exit_status: ExitStatus,
    pub forced_kill: bool,
}

pub async fn terminate_process_group(
    child: &mut AsyncGroupChild,
    graceful_timeout: Duration,
) -> io::Result<ProcessCleanupResult> {
    match tokio::time::timeout(graceful_timeout, child.wait()).await {
        Ok(Ok(status)) => Ok(ProcessCleanupResult {
            exit_status: status,
            forced_kill: false,
        }),
        Ok(Err(err)) => Err(err),
        Err(_) => {
            let exit_status = kill_process_group(child).await?;
            Ok(ProcessCleanupResult {
                exit_status,
                forced_kill: true,
            })
        }
    }
}

pub async fn kill_process_group(child: &mut AsyncGroupChild) -> io::Result<ExitStatus> {
    // Hit the whole process group, not just the leader.
    #[cfg(unix)]
    {
        if let Some(pid) = child.inner().id() {
            let pgid = getpgid(Some(Pid::from_raw(pid as i32)))
                .map_err(|e| io::Error::other(e.to_string()))?;

            for sig in [Signal::SIGINT, Signal::SIGTERM, Signal::SIGKILL] {
                tracing::info!("Sending {:?} to process group {}", sig, pgid);
                if let Err(e) = killpg(pgid, sig) {
                    tracing::warn!(
                        "Failed to send signal {:?} to process group {}: {}",
                        sig,
                        pgid,
                        e
                    );
                }

                if let Some(status) = child.inner().try_wait()? {
                    tracing::info!("Process group {} exited after {:?}", pgid, sig);
                    return Ok(status);
                }

                if sig != Signal::SIGKILL {
                    tracing::info!("Waiting 2s for process group {} to exit", pgid);
                    if let Ok(status) = wait_for_child_exit(child, Duration::from_secs(2)).await {
                        tracing::info!("Process group {} exited after {:?}", pgid, sig);
                        return Ok(status);
                    }
                }
            }
        }
    }

    child.kill().await?;
    wait_for_child_exit(child, FORCE_KILL_WAIT_TIMEOUT).await
}

async fn wait_for_child_exit(
    child: &mut AsyncGroupChild,
    timeout: Duration,
) -> io::Result<ExitStatus> {
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            format!(
                "timed out waiting for child exit after {}ms",
                timeout.as_millis()
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use command_group::AsyncCommandGroup;
    use tokio::{process::Command, time::Duration};

    use super::{ProcessCleanupResult, terminate_process_group};

    fn sleep_command(seconds: u64) -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("powershell");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-Command",
                &format!("Start-Sleep -Seconds {seconds}"),
            ]);
            command
        }

        #[cfg(unix)]
        {
            let mut command = Command::new("sh");
            command.args(["-lc", &format!("sleep {seconds}")]);
            command
        }
    }

    async fn terminate_sleep_process(
        seconds: u64,
        graceful_timeout: Duration,
    ) -> ProcessCleanupResult {
        let mut child = sleep_command(seconds)
            .group_spawn()
            .expect("spawn sleep process");

        terminate_process_group(&mut child, graceful_timeout)
            .await
            .expect("cleanup result")
    }

    #[tokio::test]
    async fn terminate_process_group_allows_natural_exit_within_timeout() {
        let result = terminate_sleep_process(1, Duration::from_secs(3)).await;

        assert!(!result.forced_kill);
        assert!(result.exit_status.success());
    }

    #[tokio::test]
    async fn terminate_process_group_force_kills_stubborn_child_after_timeout() {
        let result = terminate_sleep_process(30, Duration::from_millis(100)).await;

        assert!(result.forced_kill);
    }
}
