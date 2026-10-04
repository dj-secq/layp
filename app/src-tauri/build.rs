fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "database_file",
                "show_reminder",
                "export_backup",
                "export_zip",
                "check_backup",
                "import_backup",
                "copy_attachment",
                "open_attachment",
                "delete_attachment_files",
                "present_attachment_ids",
                "sweep_attachments",
                "show_database_folder",
                "show_log_folder",
                "set_tray_timer",
                "ensure_on_screen",
            ])),
    )
    .expect("failed to run tauri build");
}
