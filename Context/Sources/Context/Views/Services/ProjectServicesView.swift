import SwiftUI
import AppKit

struct ProjectServicesView: View {
    @EnvironmentObject var appState: AppState

    @State private var detectedServices: [DetectedService] = []
    @State private var envFiles: [EnvironmentFile] = []
    @State private var isScanning = false
    @State private var collapsedSections: Set<String> = []
    @State private var revealedKeys: Set<String> = []
    @State private var templates: [EnvironmentTemplate] = []
    @State private var editingTemplate: EnvironmentTemplate?
    @State private var editValues: [String: String] = [:]
    @State private var targetFileName: String = ".env"
    @State private var showGenerateSheet = false
    @State private var activeEnvFile: String = ".env"
    @State private var showEnvSwitchAlert = false
    @State private var envSwitchSource: EnvironmentFile?

    var body: some View {
        Group {
            if detectedServices.isEmpty && envFiles.isEmpty && templates.isEmpty && !isScanning {
                emptyState
            } else {
                servicesContent
            }
        }
        .onAppear { scanProject() }
        .onChange(of: appState.currentProject?.id) { scanProject() }
        .sheet(isPresented: $showGenerateSheet) {
            generateEnvSheet
        }
        .alert("Switch Environment",
               isPresented: $showEnvSwitchAlert,
               presenting: envSwitchSource) { source in
            Button("Copy") {
                copyEnvFile(source: source)
            }
            Button("Cancel", role: .cancel) { }
        } message: { source in
            Text("Copy \(source.name) to .env?")
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)

            Text("No Services Detected")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.secondary)

            Text("Add configuration files like firebase.json, vercel.json, or docker-compose.yml to your project.")
                .font(.system(size: 12))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Services Content

    private var servicesContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Services Section
                sectionHeader(
                    title: "Services",
                    icon: "puzzlepiece.extension",
                    count: detectedServices.count,
                    key: "services"
                )

                if !collapsedSections.contains("services") {
                    if detectedServices.isEmpty {
                        sectionEmpty("No services detected")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(detectedServices) { service in
                                serviceCard(service)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                Divider()

                // Environment Files Section
                let totalVars = envFiles.reduce(0) { $0 + $1.entries.count }
                sectionHeader(
                    title: "Environment Variables",
                    icon: "key",
                    count: totalVars,
                    key: "env"
                )

                if !collapsedSections.contains("env") {
                    if envFiles.isEmpty {
                        sectionEmpty("No environment files found")
                    } else {
                        // Environment quick-switch
                        if envFiles.count > 1 {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(envFiles) { envFile in
                                        Button {
                                            if envFile.name == ".env" || envFile.name == activeEnvFile {
                                                activeEnvFile = envFile.name
                                            } else {
                                                envSwitchSource = envFile
                                                showEnvSwitchAlert = true
                                            }
                                        } label: {
                                            Text(envFile.name)
                                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                                .foregroundColor(envFile.name == activeEnvFile ? .white : .secondary)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(
                                                    RoundedRectangle(cornerRadius: 5)
                                                        .fill(envFile.name == activeEnvFile
                                                              ? Color.accentColor
                                                              : Color(nsColor: .separatorColor).opacity(0.2))
                                                )
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                            .padding(.bottom, 6)
                        }

                        LazyVStack(spacing: 4) {
                            ForEach(envFiles) { envFile in
                                envFileCard(envFile)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }

                Divider()

                // Environment Builder Section
                sectionHeader(
                    title: "Environment Builder",
                    icon: "hammer",
                    count: templates.count,
                    key: "builder"
                )

                if !collapsedSections.contains("builder") {
                    if templates.isEmpty {
                        sectionEmpty("No template files found (.env.example, .env.template, .env.sample)")
                    } else {
                        LazyVStack(spacing: 4) {
                            ForEach(templates) { template in
                                templateCard(template)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.bottom, 20)
        }
    }

    // MARK: - Section Header

    @ViewBuilder
    private func sectionHeader(title: String, icon: String, count: Int, key: String) -> some View {
        let isCollapsed = collapsedSections.contains(key)

        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if isCollapsed {
                    collapsedSections.remove(key)
                } else {
                    collapsedSections.insert(key)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
                    .frame(width: 16)

                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)

                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.secondary.opacity(0.5)))
                }

                Spacer()

                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sectionEmpty(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
    }

    // MARK: - Service Card

    private func serviceCard(_ service: DetectedService) -> some View {
        HStack(spacing: 10) {
            Image(systemName: service.icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(.accentColor)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.accentColor.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 3) {
                Text(service.displayName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)

                if let projectId = service.projectId {
                    Text(projectId)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Text(shortenPath(service.configPath))
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(nsColor: .separatorColor).opacity(0.2))
                    )
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            if let url = service.dashboardURL {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Text("Open")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.accentColor)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 5)
                                .fill(Color.accentColor.opacity(0.12))
                        )
                }
                .buttonStyle(.plain)
                .help("Open \(service.displayName) dashboard")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Environment File Card

    private func envFileCard(_ envFile: EnvironmentFile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)

                Text(envFile.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)

                Text("\(envFile.entries.count) vars")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(nsColor: .separatorColor).opacity(0.2))
                    )

                Spacer()
            }

            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(envFile.entries.enumerated()), id: \.offset) { _, entry in
                    let entryId = "\(envFile.name).\(entry.key)"
                    HStack(spacing: 4) {
                        Text(entry.key)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(.accentColor)

                        Text("=")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary)

                        if revealedKeys.contains(entryId) {
                            Text(entry.value)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.primary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .onTapGesture {
                                    revealedKeys.remove(entryId)
                                }
                        } else {
                            Text(maskValue(entry.value))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .onTapGesture {
                                    revealedKeys.insert(entryId)
                                }
                        }

                        Spacer()
                    }
                }
            }
            .padding(.leading, 4)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Template Card

    private func templateCard(_ template: EnvironmentTemplate) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.badge.gearshape")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.orange)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.orange.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 3) {
                Text(template.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)

                Text("\(template.variables.count) variables")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(nsColor: .separatorColor).opacity(0.2))
                    )
            }

            Spacer()

            Button {
                editingTemplate = template
                editValues = Dictionary(
                    uniqueKeysWithValues: template.variables.map { ($0.key, $0.defaultValue) }
                )
                targetFileName = ".env"
                showGenerateSheet = true
            } label: {
                Text("Generate .env")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.accentColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 5)
                            .fill(Color.accentColor.opacity(0.12))
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.7))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Generate Env Sheet

    private var generateEnvSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Generate Environment File")
                .font(.system(size: 15, weight: .semibold))

            // Target filename picker
            HStack {
                Text("Target file:")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)

                Picker("", selection: $targetFileName) {
                    Text(".env").tag(".env")
                    Text(".env.local").tag(".env.local")
                    Text(".env.development").tag(".env.development")
                    Text(".env.staging").tag(".env.staging")
                    Text(".env.production").tag(".env.production")
                }
                .labelsHidden()
                .frame(width: 180)
            }

            // Overwrite warning
            if targetFileExists {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                    Text("This will overwrite the existing file")
                        .font(.system(size: 11))
                }
                .foregroundColor(.orange)
            }

            Divider()

            // Variable list
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let template = editingTemplate {
                        ForEach(template.variables) { variable in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 4) {
                                    Text(variable.key)
                                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                                        .foregroundColor(.accentColor)

                                    if variable.isRequired {
                                        Text("*")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundColor(.red)
                                    }
                                }

                                if let comment = variable.comment {
                                    Text(comment)
                                        .font(.system(size: 10))
                                        .foregroundColor(.secondary)
                                }

                                TextField("Value", text: Binding(
                                    get: { editValues[variable.key] ?? "" },
                                    set: { editValues[variable.key] = $0 }
                                ))
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                            }
                        }
                    }
                }
            }
            .frame(maxHeight: 350)

            Divider()

            // Action buttons
            HStack {
                Spacer()

                Button("Cancel") {
                    showGenerateSheet = false
                }

                Button("Generate") {
                    generateEnvFile()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 450)
        .frame(minHeight: 300)
    }

    private var targetFileExists: Bool {
        guard let project = appState.currentProject else { return false }
        let path = (project.path as NSString).appendingPathComponent(targetFileName)
        return FileManager.default.fileExists(atPath: path)
    }

    // MARK: - Helpers

    private func generateEnvFile() {
        guard let project = appState.currentProject,
              let template = editingTemplate else { return }

        var content = ""
        for variable in template.variables {
            if let comment = variable.comment {
                content += "# \(comment)\n"
            }
            let value = editValues[variable.key] ?? variable.defaultValue
            content += "\(variable.key)=\(value)\n"
        }

        let filePath = (project.path as NSString).appendingPathComponent(targetFileName)
        try? content.write(toFile: filePath, atomically: true, encoding: .utf8)

        // Re-scan environment files
        envFiles = ProjectServicesDetector.scanEnvironmentFiles(projectPath: project.path)
        showGenerateSheet = false
    }

    private func copyEnvFile(source: EnvironmentFile) {
        guard let project = appState.currentProject else { return }
        let targetPath = (project.path as NSString).appendingPathComponent(".env")
        try? FileManager.default.removeItem(atPath: targetPath)
        try? FileManager.default.copyItem(atPath: source.path, toPath: targetPath)
        activeEnvFile = source.name
        envFiles = ProjectServicesDetector.scanEnvironmentFiles(projectPath: project.path)
    }

    private func scanProject() {
        guard let project = appState.currentProject else {
            detectedServices = []
            envFiles = []
            templates = []
            return
        }
        isScanning = true
        detectedServices = ProjectServicesDetector.scan(projectPath: project.path)
        envFiles = ProjectServicesDetector.scanEnvironmentFiles(projectPath: project.path)
        templates = ProjectServicesDetector.scanTemplates(projectPath: project.path)
        isScanning = false
    }

    private func shortenPath(_ path: String) -> String {
        guard let project = appState.currentProject else { return path }
        if path.hasPrefix(project.path) {
            let relative = String(path.dropFirst(project.path.count))
            return relative.hasPrefix("/") ? String(relative.dropFirst()) : relative
        }
        return path
    }

    private func maskValue(_ value: String) -> String {
        if value.count <= 4 {
            return String(repeating: "*", count: value.count)
        }
        return String(repeating: "*", count: min(value.count, 20))
    }
}
