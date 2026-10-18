//! `esefact-sim-slave`: DEV/TEST TOOL ONLY (Modbus TCP slave simulator for QA).
//! Not the Modbus Slave product and not bundled with the app. See docs/SETUP.md.

use std::process::ExitCode;

use dev_sim_slave::{parse_args, start, stdout_logger, CliError, HELP, USAGE};

/// Holds the OS timer precision of the app (`esefact_desktop_lib::os_timer`) until dropped.
#[cfg(feature = "os-timer")]
struct TimerHold(esefact_desktop_lib::os_timer::SystemTimerResolution);

#[cfg(feature = "os-timer")]
impl TimerHold {
    fn new() -> Self {
        use modbus_master::TimerResolution;
        let timer = esefact_desktop_lib::os_timer::SystemTimerResolution;
        timer.acquire();
        Self(timer)
    }
}

#[cfg(feature = "os-timer")]
impl Drop for TimerHold {
    fn drop(&mut self) {
        use modbus_master::TimerResolution;
        self.0.release();
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let config = match parse_args(std::env::args().skip(1)) {
        Ok(c) => c,
        Err(CliError::Help) => {
            println!("{USAGE}{HELP}");
            return ExitCode::SUCCESS;
        }
        Err(CliError::Invalid(m)) => {
            eprintln!("error: {m}\n\n{USAGE}{HELP}");
            return ExitCode::from(2);
        }
    };
    // Feature `os-timer` (REPORT-007 CHK2-D3): the app's 1 ms timer precision for the whole
    // run, so injected delays are not quantized to the 15.6 ms Windows tick.
    #[cfg(feature = "os-timer")]
    let _timer = TimerHold::new();
    let handle = match start(config, stdout_logger()).await {
        Ok(h) => h,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };
    tokio::select! {
        () = handle.wait_quit() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    drop(handle);
    ExitCode::SUCCESS
}
