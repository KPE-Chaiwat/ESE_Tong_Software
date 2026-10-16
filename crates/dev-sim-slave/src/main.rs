//! `esefact-sim-slave`: DEV/TEST TOOL ONLY (Modbus TCP slave simulator for QA).
//! Not the Modbus Slave product and not bundled with the app. See docs/SETUP.md.

use std::process::ExitCode;

use dev_sim_slave::{parse_args, start, stdout_logger, CliError, HELP, USAGE};

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
