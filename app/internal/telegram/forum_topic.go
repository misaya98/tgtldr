package telegram

import "github.com/gotd/td/tg"

const generalForumTopicID = 1

// resolveMessageTopic 解析论坛消息所属的 Telegram 话题 ID。
// 非论坛消息返回 (0, false, false)，论坛消息无法取得具体话题时使用 General。
func resolveMessageTopic(msg *tg.Message, isForum bool) (telegramTopicID int, isForumMessage bool, ok bool) {
	if !isForum {
		return 0, false, false
	}
	header, isReplyHeader := msg.ReplyTo.(*tg.MessageReplyHeader)
	if !isReplyHeader || header == nil {
		return generalForumTopicID, true, true
	}
	if header.ReplyToTopID != 0 {
		return header.ReplyToTopID, true, true
	}
	if header.ReplyToMsgID != 0 {
		return header.ReplyToMsgID, true, true
	}
	return generalForumTopicID, true, true
}

func replyToTopID(msg *tg.Message) int {
	if msg.ReplyTo == nil {
		return 0
	}
	header, ok := msg.ReplyTo.(*tg.MessageReplyHeader)
	if !ok || header == nil {
		return 0
	}
	return header.ReplyToTopID
}
