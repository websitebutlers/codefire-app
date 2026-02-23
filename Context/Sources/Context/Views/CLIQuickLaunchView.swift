import SwiftUI

/// Quick-launch buttons for each supported CLI, displayed in the terminal tab bar.
/// Each button opens a dropdown with launch options and MCP/instruction setup.
struct CLIQuickLaunchView: View {
    @EnvironmentObject var appSettings: AppSettings
    let projectPath: String
    let onLaunchCLI: (_ title: String, _ command: String) -> Void

    @State private var setupResult: String?
    @State private var showingToast = false

    private let injector = ContextInjector()

    var body: some View {
        HStack(spacing: 2) {
            ForEach(CLIProvider.allCases) { cli in
                cliMenu(for: cli)
            }
        }
    }

    @ViewBuilder
    private func cliMenu(for cli: CLIProvider) -> some View {
        let installed = cli.isInstalled
        let isPreferred = appSettings.preferredCLI == cli

        Menu {
            if installed {
                Button("Launch \(cli.displayName)") {
                    onLaunchCLI(cli.displayName, cli.command)
                }
            }

            Divider()

            Button("Setup MCP") {
                setupMCP(for: cli)
            }

            Button("Setup Instructions") {
                setupInstructions(for: cli)
            }

            Divider()

            if installed {
                Label("Installed", systemImage: "checkmark.circle.fill")
            } else {
                Label("Not installed", systemImage: "xmark.circle")
            }

            if isPreferred {
                Label("Preferred CLI", systemImage: "star.fill")
            } else {
                Button("Set as Preferred") {
                    appSettings.preferredCLI = cli
                }
            }
        } label: {
            ZStack {
                Image(systemName: cli.iconName)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(installed ? cli.color : .secondary.opacity(0.3))
                    .frame(width: 28, height: 26)

                // Preferred indicator dot
                if isPreferred {
                    Circle()
                        .fill(cli.color)
                        .frame(width: 5, height: 5)
                        .offset(x: 8, y: -8)
                }
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .frame(width: 28)
        .help(cli.displayName + (installed ? "" : " (not installed)"))
    }

    // MARK: - Setup Actions

    private func setupMCP(for cli: CLIProvider) {
        do {
            let path = try injector.installMCP(for: cli, projectPath: projectPath)
            setupResult = "MCP configured for \(cli.displayName) at \(path)"
        } catch {
            setupResult = "Failed: \(error.localizedDescription)"
        }
    }

    private func setupInstructions(for cli: CLIProvider) {
        do {
            try injector.updateInstructionFile(for: cli, projectPath: projectPath)
            setupResult = "\(cli.instructionFileName) updated"
        } catch {
            setupResult = "Failed: \(error.localizedDescription)"
        }
    }
}
