// The desktop entry point. Android never runs this: the generated activity loads
// the library and calls `run` through `mobile_entry_point`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aprinote_lib::run()
}
