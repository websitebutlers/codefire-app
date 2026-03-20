import SwiftUI
import Combine

struct ProjectDocsView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var premiumService = PremiumService.shared
    @State private var docs: [ProjectDoc] = []
    @State private var selectedDoc: ProjectDoc?
    @State private var editTitle: String = ""
    @State private var editContent: String = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var loadError: String?

    // Debounce publishers
    @State private var titleSubject = PassthroughSubject<String, Never>()
    @State private var contentSubject = PassthroughSubject<String, Never>()
    @State private var cancellables = Set<AnyCancellable>()

    var body: some View {
        Group {
            if !premiumService.status.authenticated {
                notAuthenticatedView
            } else if premiumService.isRestoringSession {
                ProgressView("Loading session...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                docsContent
            }
        }
        .task {
            await premiumService.ensureProfileLoaded()
            if premiumService.status.authenticated && premiumService.status.user != nil {
                setupDebounce()
                await loadDocs()
            }
        }
    }

    private var notAuthenticatedView: some View {
        VStack(spacing: 12) {
            Image(systemName: "book")
                .font(.system(size: 32))
                .foregroundColor(.secondary.opacity(0.5))
            Text("Team Docs")
                .font(.system(size: 15, weight: .semibold))
            Text("Sign in to your team account in Settings → Team to access shared project documents.")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var docsContent: some View {
        HSplitView {
            // Sidebar: doc list
            VStack(spacing: 0) {
                HStack {
                    Text("Docs")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Button {
                        createNewDoc()
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
                    .help("New Document")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                Divider()

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = loadError {
                    VStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 24))
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Retry") {
                            Task { await loadDocs() }
                        }
                        .font(.system(size: 11))
                    }
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if docs.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "book")
                            .font(.system(size: 24))
                            .foregroundColor(.secondary.opacity(0.5))
                        Text("No documents")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                        Button("Create First Doc") {
                            createNewDoc()
                        }
                        .font(.system(size: 11))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(docs) { doc in
                                DocListRow(doc: doc, isSelected: selectedDoc?.id == doc.id)
                                    .onTapGesture {
                                        selectDoc(doc)
                                    }
                                    .contextMenu {
                                        Button(role: .destructive) {
                                            deleteDoc(doc)
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                        .padding(6)
                    }
                }
            }
            .frame(minWidth: 180, idealWidth: 220)

            // Editor
            if selectedDoc != nil {
                VStack(spacing: 0) {
                    // Title field
                    HStack {
                        TextField("Document title", text: $editTitle)
                            .textFieldStyle(.plain)
                            .font(.system(size: 15, weight: .semibold))
                            .onChange(of: editTitle) { _, newValue in
                                titleSubject.send(newValue)
                            }

                        if isSaving {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.6)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)

                    Divider()

                    // Content editor
                    TextEditor(text: $editContent)
                        .font(.system(size: 13, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .onChange(of: editContent) { _, newValue in
                            contentSubject.send(newValue)
                        }
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "book")
                        .font(.system(size: 28))
                        .foregroundColor(.secondary.opacity(0.5))
                    Text("Select a document")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: - Debounced Auto-Save

    private func setupDebounce() {
        titleSubject
            .debounce(for: .seconds(1), scheduler: RunLoop.main)
            .sink { _ in
                saveCurrentDoc()
            }
            .store(in: &cancellables)

        contentSubject
            .debounce(for: .seconds(1), scheduler: RunLoop.main)
            .sink { _ in
                saveCurrentDoc()
            }
            .store(in: &cancellables)
    }

    // MARK: - Actions

    private func selectDoc(_ doc: ProjectDoc) {
        selectedDoc = doc
        editTitle = doc.title
        editContent = doc.content
    }

    private func createNewDoc() {
        guard let projectId = appState.currentProject?.id else { return }
        Task {
            do {
                let doc = try await premiumService.createProjectDoc(
                    projectId: projectId,
                    title: "Untitled",
                    content: ""
                )
                await loadDocs()
                selectDoc(doc)
            } catch {
                print("ProjectDocs: failed to create doc: \(error)")
            }
        }
    }

    private func saveCurrentDoc() {
        guard let doc = selectedDoc else { return }
        isSaving = true
        Task {
            do {
                let updated = try await premiumService.updateProjectDoc(
                    docId: doc.id,
                    title: editTitle,
                    content: editContent
                )
                // Update local list
                if let index = docs.firstIndex(where: { $0.id == updated.id }) {
                    docs[index] = updated
                }
                selectedDoc = updated
            } catch {
                print("ProjectDocs: failed to save: \(error)")
            }
            isSaving = false
        }
    }

    private func deleteDoc(_ doc: ProjectDoc) {
        Task {
            do {
                try await premiumService.deleteProjectDoc(docId: doc.id)
                if selectedDoc?.id == doc.id {
                    selectedDoc = nil
                    editTitle = ""
                    editContent = ""
                }
                await loadDocs()
            } catch {
                print("ProjectDocs: failed to delete: \(error)")
            }
        }
    }

    private func loadDocs() async {
        guard let projectId = appState.currentProject?.id else { return }
        isLoading = true
        loadError = nil
        do {
            docs = try await premiumService.listProjectDocs(projectId: projectId)
        } catch {
            loadError = "Failed to load docs: \(error.localizedDescription)"
            print("ProjectDocs: failed to load: \(error)")
        }
        isLoading = false
    }
}

// MARK: - Doc List Row

private struct DocListRow: View {
    let doc: ProjectDoc
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: 11))
                .foregroundColor(isSelected ? .accentColor : .secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(doc.title.isEmpty ? "Untitled" : doc.title)
                    .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? .accentColor : .primary)
                    .lineLimit(1)

                Text(doc.content.prefix(60).replacingOccurrences(of: "\n", with: " "))
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.7))
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
        )
        .contentShape(Rectangle())
    }
}
