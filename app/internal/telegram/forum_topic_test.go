package telegram

import (
	"testing"

	"github.com/gotd/td/tg"
	. "github.com/smartystreets/goconvey/convey"
)

func TestResolveMessageTopic(t *testing.T) {
	Convey("论坛消息按 reply header 解析话题 ID", t, func() {
		topicID, isForumMessage, ok := resolveMessageTopic(&tg.Message{
			ReplyTo: &tg.MessageReplyHeader{
				ReplyToMsgID: 7310786,
				ReplyToTopID: 7310786,
			},
		}, true)
		So(topicID, ShouldEqual, 7310786)
		So(isForumMessage, ShouldBeTrue)
		So(ok, ShouldBeTrue)

		topicID, isForumMessage, ok = resolveMessageTopic(&tg.Message{
			ReplyTo: &tg.MessageReplyHeader{ReplyToMsgID: 458347},
		}, true)
		So(topicID, ShouldEqual, 458347)
		So(isForumMessage, ShouldBeTrue)
		So(ok, ShouldBeTrue)

		topicID, isForumMessage, ok = resolveMessageTopic(&tg.Message{
			ReplyTo: &tg.MessageReplyHeader{
				ReplyToMsgID: 9001,
				ForumTopic:   true,
			},
		}, true)
		So(topicID, ShouldEqual, 9001)
		So(isForumMessage, ShouldBeTrue)
		So(ok, ShouldBeTrue)
	})
}

func TestResolveMessageTopicGeneralFallback(t *testing.T) {
	Convey("论坛消息没有 reply header 时归入 General", t, func() {
		topicID, isForumMessage, ok := resolveMessageTopic(&tg.Message{}, true)
		So(topicID, ShouldEqual, 1)
		So(isForumMessage, ShouldBeTrue)
		So(ok, ShouldBeTrue)
	})
}

func TestResolveMessageTopicNonForum(t *testing.T) {
	Convey("普通群组不解析话题", t, func() {
		topicID, isForumMessage, ok := resolveMessageTopic(&tg.Message{
			ReplyTo: &tg.MessageReplyHeader{
				ReplyToMsgID: 10,
				ReplyToTopID: 10,
			},
		}, false)
		So(topicID, ShouldEqual, 0)
		So(isForumMessage, ShouldBeFalse)
		So(ok, ShouldBeFalse)
	})
}
