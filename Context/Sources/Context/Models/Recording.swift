import Foundation
import GRDB

struct Recording: Codable, Identifiable, FetchableRecord, MutablePersistableRecord {
    var id: String // UUID, generated before recording starts
    var projectId: String
    var title: String
    var audioPath: String
    var duration: Double // seconds
    var transcript: String?
    var status: String // "recording", "transcribing", "extracting", "ready", "error"
    var errorMessage: String?
    var createdAt: Date

    static let databaseTableName = "recordings"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let projectId = Column(CodingKeys.projectId)
        static let title = Column(CodingKeys.title)
        static let status = Column(CodingKeys.status)
        static let createdAt = Column(CodingKeys.createdAt)
        static let duration = Column(CodingKeys.duration)
        static let transcript = Column(CodingKeys.transcript)
        static let errorMessage = Column(CodingKeys.errorMessage)
    }

    enum Status: String {
        case recording
        case transcribing
        case extracting
        case ready
        case error
    }
}
