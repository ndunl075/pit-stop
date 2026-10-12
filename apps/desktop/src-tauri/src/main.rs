#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app;
mod commands;
mod navigation;
mod receiver;
mod sessions;
mod settings;
fn main() {
    app::run();
}
