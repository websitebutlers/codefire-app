import SwiftUI

struct HomeView: View {
    var body: some View {
        VSplitView {
            KanbanBoard(globalMode: true)
                .frame(minHeight: 200)
            NoteListView(globalMode: true)
                .frame(minHeight: 150)
        }
    }
}
