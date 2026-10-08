fn main() {
    // TS is the accepted source of truth. Native artifacts must be byte-exact
    // extracts; a stale generated migration fails the build, never diverges.
    let source = std::fs::read_to_string("../src/persistence/migrations.ts").expect("migration source");
    let mut parts = Vec::new();
    for version in 1..=4 {
        let marker = format!("const migrationV{version} = `");
        let sql = source.split_once(&marker).expect("migration marker").1
            .split_once("`;").expect("migration terminator").0;
        parts.push(sql);
    }
    let m4 = std::fs::read_to_string("../migrations/004.sql").expect("native M4 artifact");
    assert_eq!(m4.trim_end(), parts[3].trim_end(), "native M4 artifact drift");
    let mut bootstrap = String::from("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);\n");
    for (index, sql) in parts[..3].iter().enumerate() {
        bootstrap.push_str(sql);
        bootstrap.push_str(&format!("\nINSERT INTO schema_migrations(version, applied_at) VALUES({}, '2000-01-01T00:00:00.000Z');\n", index + 1));
    }
    assert_eq!(std::fs::read_to_string("../migrations/003-bootstrap.sql").expect("V3 artifact").trim_end(), bootstrap.trim_end(), "V3 artifact drift");
    println!("cargo:rerun-if-changed=../src/persistence/migrations.ts");
    println!("cargo:rerun-if-changed=../migrations");
    tauri_build::build()
}
