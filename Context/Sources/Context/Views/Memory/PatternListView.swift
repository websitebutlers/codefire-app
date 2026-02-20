import SwiftUI
import GRDB

struct PatternListView: View {
    @EnvironmentObject var appState: AppState
    @State private var patterns: [Pattern] = []
    @State private var selectedCategory: String? = nil
    @State private var showingNewPattern = false

    private let categories = ["Architecture", "Naming", "Schema", "Workflow"]

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Patterns & Conventions")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Button {
                    showingNewPattern = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11))
                        Text("Add Pattern")
                            .font(.system(size: 12))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(5)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            // Category filter pills
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    CategoryPill(label: "All", isSelected: selectedCategory == nil) {
                        selectedCategory = nil
                    }
                    ForEach(categories, id: \.self) { category in
                        CategoryPill(
                            label: category,
                            isSelected: selectedCategory == category.lowercased()
                        ) {
                            if selectedCategory == category.lowercased() {
                                selectedCategory = nil
                            } else {
                                selectedCategory = category.lowercased()
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }

            Divider()

            // Pattern list
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(filteredPatterns) { pattern in
                        PatternCard(pattern: pattern, onDelete: {
                            deletePattern(pattern)
                        })
                    }
                }
                .padding(12)
            }
        }
        .sheet(isPresented: $showingNewPattern) {
            NewPatternSheet(isPresented: $showingNewPattern, onCreate: { category, title, description in
                createPattern(category: category, title: title, description: description)
            })
        }
        .onAppear { loadPatterns() }
        .onChange(of: appState.currentProject) { _, _ in loadPatterns() }
    }

    private var filteredPatterns: [Pattern] {
        if let category = selectedCategory {
            return patterns.filter { $0.category == category }
        }
        return patterns
    }

    // MARK: - CRUD

    private func loadPatterns() {
        guard let project = appState.currentProject else {
            patterns = []
            return
        }

        do {
            patterns = try DatabaseService.shared.dbQueue.read { db in
                try Pattern
                    .filter(Column("projectId") == project.id)
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
            }
        } catch {
            print("PatternListView: failed to load patterns: \(error)")
        }
    }

    private func createPattern(category: String, title: String, description: String) {
        guard let project = appState.currentProject else { return }

        var pattern = Pattern(
            id: nil,
            projectId: project.id,
            category: category,
            title: title,
            description: description,
            sourceSession: nil,
            autoDetected: false,
            createdAt: Date()
        )

        do {
            try DatabaseService.shared.dbQueue.write { db in
                try pattern.insert(db)
            }
            loadPatterns()
        } catch {
            print("PatternListView: failed to create pattern: \(error)")
        }
    }

    private func deletePattern(_ pattern: Pattern) {
        do {
            try DatabaseService.shared.dbQueue.write { db in
                _ = try Pattern.deleteOne(db, id: pattern.id)
            }
            loadPatterns()
        } catch {
            print("PatternListView: failed to delete pattern: \(error)")
        }
    }
}

// MARK: - Pattern Card

struct PatternCard: View {
    let pattern: Pattern
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Top row: badges + delete
            HStack(spacing: 6) {
                // Category badge
                Text(pattern.category.capitalized)
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(categoryColor.opacity(0.15))
                    .foregroundColor(categoryColor)
                    .cornerRadius(4)

                if pattern.autoDetected {
                    Text("auto")
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.gray.opacity(0.15))
                        .foregroundColor(.secondary)
                        .cornerRadius(4)
                }

                Spacer()

                Button {
                    onDelete()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Delete pattern")
            }

            // Title
            Text(pattern.title)
                .font(.system(size: 13, weight: .medium))

            // Description
            Text(pattern.description)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .lineLimit(3)
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }

    private var categoryColor: Color {
        switch pattern.category {
        case "architecture": return .blue
        case "naming": return .green
        case "schema": return .orange
        case "workflow": return .purple
        default: return .gray
        }
    }
}

// MARK: - Category Pill

struct CategoryPill: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(isSelected ? Color.accentColor.opacity(0.2) : Color(nsColor: .controlBackgroundColor))
                .foregroundColor(isSelected ? .accentColor : .secondary)
                .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - New Pattern Sheet

struct NewPatternSheet: View {
    @Binding var isPresented: Bool
    let onCreate: (String, String, String) -> Void

    @State private var category: String = "architecture"
    @State private var title: String = ""
    @State private var description: String = ""

    private let categories = ["architecture", "naming", "schema", "workflow"]

    var body: some View {
        VStack(spacing: 16) {
            Text("New Pattern")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                Text("Category")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                Picker("Category", selection: $category) {
                    ForEach(categories, id: \.self) { cat in
                        Text(cat.capitalized).tag(cat)
                    }
                }
                .labelsHidden()
            }
            .frame(width: 320, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                Text("Title")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                TextField("Pattern title", text: $title)
                    .textFieldStyle(.roundedBorder)
            }
            .frame(width: 320)

            VStack(alignment: .leading, spacing: 8) {
                Text("Description")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                TextEditor(text: $description)
                    .font(.system(size: 12))
                    .frame(height: 80)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                    )
            }
            .frame(width: 320)

            HStack(spacing: 12) {
                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("Save") {
                    let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
                    if !trimmedTitle.isEmpty {
                        onCreate(category, trimmedTitle, description)
                        isPresented = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
    }
}
