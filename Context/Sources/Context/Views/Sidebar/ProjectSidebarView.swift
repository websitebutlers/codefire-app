import SwiftUI

// MARK: - ProjectSidebarView

struct ProjectSidebarView: View {
    @EnvironmentObject var appState: AppState

    @State private var showingNewClient = false
    @State private var newClientName = ""
    @State private var newClientColor = Client.defaultColors[0]
    @State private var expandedClients: Set<String> = [] // client IDs

    var body: some View {
        VStack(spacing: 0) {
            // App title
            HStack(spacing: 6) {
                Image(systemName: "rectangle.grid.1x2.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.accentColor)
                Text("Context")
                    .font(.system(size: 13, weight: .bold))
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            ScrollView {
                VStack(spacing: 2) {
                    // Home / Planner button
                    SidebarItem(
                        icon: "house.fill",
                        label: "Planner",
                        isSelected: appState.isHomeView,
                        accentColor: .accentColor
                    ) {
                        appState.selectHome()
                    }
                    .padding(.horizontal, 8)
                    .padding(.top, 8)

                    Divider()
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)

                    // Client groups
                    ForEach(appState.projectsByClient, id: \.client?.id) { group in
                        if let client = group.client {
                            clientSection(client: client, projects: group.projects)
                        } else {
                            ungroupedSection(projects: group.projects)
                        }
                    }
                }
                .padding(.bottom, 8)
            }

            Divider()

            // Add client button
            Button {
                showingNewClient = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .semibold))
                    Text("Add Client")
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
        }
        .frame(width: 200)
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(isPresented: $showingNewClient) {
            NewClientSheet(
                isPresented: $showingNewClient,
                name: $newClientName,
                color: $newClientColor,
                onCreate: {
                    appState.createClient(name: newClientName, color: newClientColor)
                    newClientName = ""
                    newClientColor = Client.defaultColors[0]
                }
            )
        }
        .onAppear {
            // Expand all client groups by default
            for group in appState.projectsByClient {
                if let client = group.client {
                    expandedClients.insert(client.id)
                }
            }
        }
    }

    // MARK: - Client Section

    @ViewBuilder
    private func clientSection(client: Client, projects: [Project]) -> some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    if expandedClients.contains(client.id) {
                        expandedClients.remove(client.id)
                    } else {
                        expandedClients.insert(client.id)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hex: client.color) ?? .blue)
                        .frame(width: 8, height: 8)
                    Text(client.name)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                        .textCase(.uppercase)
                    Spacer()
                    Image(systemName: expandedClients.contains(client.id) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Rename...") { /* TODO: inline rename */ }
                Button("Delete", role: .destructive) {
                    appState.deleteClient(client)
                }
            }

            if expandedClients.contains(client.id) {
                ForEach(projects) { project in
                    projectRow(project: project)
                }
            }
        }
    }

    // MARK: - Ungrouped Section

    @ViewBuilder
    private func ungroupedSection(projects: [Project]) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(width: 8, height: 8)
                Text("Ungrouped")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)

            ForEach(projects) { project in
                projectRow(project: project)
            }
        }
    }

    // MARK: - Project Row

    @ViewBuilder
    private func projectRow(project: Project) -> some View {
        let isSelected = !appState.isHomeView && appState.currentProject?.id == project.id

        SidebarItem(
            icon: "folder.fill",
            label: project.name,
            isSelected: isSelected,
            accentColor: .accentColor
        ) {
            appState.selectProject(project)
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .contextMenu {
            Menu("Set Client") {
                Button("None") {
                    appState.updateProjectClient(project, clientId: nil)
                }
                Divider()
                ForEach(appState.clients) { client in
                    Button(client.name) {
                        appState.updateProjectClient(project, clientId: client.id)
                    }
                }
            }
        }
    }
}

// MARK: - SidebarItem

struct SidebarItem: View {
    let icon: String
    let label: String
    let isSelected: Bool
    let accentColor: Color
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? accentColor : .secondary)
                    .frame(width: 16)
                Text(label)
                    .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                    .foregroundColor(isSelected ? .primary : .secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(isSelected
                          ? accentColor.opacity(0.12)
                          : isHovering ? Color(nsColor: .controlBackgroundColor).opacity(0.5) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in isHovering = hovering }
    }
}

// MARK: - NewClientSheet

struct NewClientSheet: View {
    @Binding var isPresented: Bool
    @Binding var name: String
    @Binding var color: String
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("New Client")
                .font(.system(size: 15, weight: .semibold))

            TextField("Client name", text: $name)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))
                .frame(width: 260)

            HStack(spacing: 6) {
                ForEach(Client.defaultColors, id: \.self) { hex in
                    Circle()
                        .fill(Color(hex: hex) ?? .blue)
                        .frame(width: 22, height: 22)
                        .overlay(
                            Circle()
                                .strokeBorder(Color.white, lineWidth: color == hex ? 2 : 0)
                        )
                        .shadow(color: color == hex ? .accentColor.opacity(0.4) : .clear, radius: 3)
                        .onTapGesture { color = hex }
                }
            }

            HStack(spacing: 12) {
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                        onCreate()
                        isPresented = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
    }
}

// MARK: - Color Hex Extension

extension Color {
    init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6,
              let val = UInt64(h, radix: 16) else { return nil }
        self.init(
            red: Double((val >> 16) & 0xFF) / 255,
            green: Double((val >> 8) & 0xFF) / 255,
            blue: Double(val & 0xFF) / 255
        )
    }
}
