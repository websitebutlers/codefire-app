import SwiftUI

/// Quick-launch buttons for each supported CLI, displayed in the terminal tab bar.
/// Each button opens a dropdown with launch options and MCP/instruction setup.
struct CLIQuickLaunchView: View {
    @EnvironmentObject var appSettings: AppSettings
    let projectPath: String
    let onLaunchCLI: (_ title: String, _ command: String) -> Void

    @State private var setupResult: String?
    @State private var installCacheLoaded = false

    private let injector = ContextInjector()

    var body: some View {
        HStack(spacing: 6) {
            let _ = installCacheLoaded  // force re-evaluation after cache loads
            ForEach(CLIProvider.allCases) { cli in
                cliMenu(for: cli)
            }
        }
        .task {
            await CLIProvider.refreshInstallationStatus()
            installCacheLoaded = true
        }
        .alert("Setup", isPresented: Binding(
            get: { setupResult != nil },
            set: { if !$0 { setupResult = nil } }
        )) {
            Button("OK") { setupResult = nil }
        } message: {
            Text(setupResult ?? "")
        }
    }

    @ViewBuilder
    private func cliMenu(for cli: CLIProvider) -> some View {
        let installed = cli.isInstalled
        let isPreferred = appSettings.preferredCLI == cli

        Menu {
            if installed {
                Button("Launch \(cli.displayName)") {
                    onLaunchCLI(cli.displayName, appSettings.commandWithArgs(for: cli))
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
            HStack(spacing: 5) {
                Circle()
                    .fill(installed ? cli.color : .secondary.opacity(0.3))
                    .frame(width: 7, height: 7)

                Text(cli.shortName)
                    .font(.system(size: 11, weight: isPreferred ? .semibold : .medium))
                    .foregroundColor(installed ? .primary : .secondary.opacity(0.5))

                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background {
                Capsule()
                    .fill(isPreferred
                        ? cli.color.opacity(0.15)
                        : Color.secondary.opacity(0.08))
                    .overlay(
                        Capsule()
                            .strokeBorder(isPreferred
                                ? cli.color.opacity(0.3)
                                : Color.secondary.opacity(0.15),
                            lineWidth: 1)
                    )
            }
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
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
