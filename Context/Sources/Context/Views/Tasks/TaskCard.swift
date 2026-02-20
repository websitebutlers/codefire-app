import SwiftUI

struct TaskCardView: View {
    let task: TaskItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(2)

            if let description = task.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(3)
            }

            HStack {
                // Source badge
                Text(task.source)
                    .font(.system(size: 9, weight: .medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(task.source == "claude" ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
                    .foregroundColor(task.source == "claude" ? .blue : .gray)
                    .cornerRadius(4)

                Spacer()

                Text(task.createdAt.formatted(.dateTime.month(.abbreviated).day()))
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(6)
        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }
}
