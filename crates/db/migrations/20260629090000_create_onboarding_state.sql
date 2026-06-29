-- Local singleton state for first-run onboarding and upgrade guide progress.
CREATE TABLE IF NOT EXISTS onboarding_state (
    id                         INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    welcome_seen_at            TEXT,
    onboarding_completed_at    TEXT,
    current_step               TEXT    NOT NULL DEFAULT 'scenario'
                                   CHECK (current_step IN (
                                       'scenario', 'executor', 'project_path', 'appearance'
                                   )),
    selected_scenario          TEXT
                                   CHECK (selected_scenario IS NULL
                                          OR selected_scenario IN (
                                              'software', 'design', 'research', 'other'
                                          )),
    recommended_team_name      TEXT,
    team_config_json           TEXT,
    project_path               TEXT,
    project_path_is_git        BOOLEAN NOT NULL DEFAULT 0,
    language                   TEXT
                                   CHECK (language IS NULL
                                          OR language IN (
                                              'browser', 'en', 'fr', 'ja', 'es',
                                              'ko', 'zh_hans', 'zh_hant'
                                          )),
    appearance                 TEXT
                                   CHECK (appearance IS NULL
                                          OR appearance IN ('light', 'dark', 'system')),
    last_seen_upgrade_version  TEXT,
    created_at                 TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at                 TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
);
