import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            TerminalSettingsTab(settings: settings)
                .tabItem {
                    Label("Terminal", systemImage: "terminal")
                }

            ContextEngineSettingsTab(settings: settings)
                .tabItem {
                    Label("Context Engine", systemImage: "brain")
                }
        }
        .frame(width: 500, height: 350)
    }
}

// MARK: - General Tab

private struct GeneralSettingsTab: View {
    var body: some View {
        Form {
            Text("General settings")
                .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Terminal Tab

private struct TerminalSettingsTab: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            Section("Font") {
                HStack {
                    Text("Font Size: \(Int(settings.terminalFontSize))pt")
                    Slider(
                        value: $settings.terminalFontSize,
                        in: 10...24,
                        step: 1
                    )
                }
            }

            Section("Scrollback") {
                Stepper(
                    "Scrollback Lines: \(settings.scrollbackLines)",
                    value: $settings.scrollbackLines,
                    in: 1000...100000,
                    step: 1000
                )
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - Context Engine Tab

private struct ContextEngineSettingsTab: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        Form {
            Section("Automation") {
                Toggle("Auto-snapshot sessions", isOn: $settings.autoSnapshotSessions)
                Toggle("Auto-update codebase tree", isOn: $settings.autoUpdateCodebaseTree)
                Toggle("MCP server auto-start", isOn: $settings.mcpServerAutoStart)
                Toggle("CLAUDE.md injection", isOn: $settings.claudeMDInjection)
            }

            Section("Timing") {
                HStack {
                    Text("Snapshot debounce: \(Int(settings.snapshotDebounce))s")
                    Slider(
                        value: $settings.snapshotDebounce,
                        in: 5...120,
                        step: 5
                    )
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}
