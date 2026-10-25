package telegram

import (
	"testing"
	"time"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	messagesquery "github.com/gotd/td/telegram/query/messages"
	"github.com/gotd/td/tg"
	. "github.com/smartystreets/goconvey/convey"
)

func TestParseHistoryRange(t *testing.T) {
	Convey("历史回补日期范围会按本地时区解析并包含结束日", t, func() {
		start, end, err := parseHistoryRange("2026-04-01", "2026-04-03", "Asia/Shanghai")

		So(err, ShouldBeNil)
		So(start, ShouldEqual, time.Date(2026, 3, 31, 16, 0, 0, 0, time.UTC))
		So(end, ShouldEqual, time.Date(2026, 4, 3, 16, 0, 0, 0, time.UTC))
	})

	Convey("结束日期早于开始日期时会报错", t, func() {
		_, _, err := parseHistoryRange("2026-04-03", "2026-04-01", "Asia/Shanghai")

		So(err, ShouldNotBeNil)
		So(err.Error(), ShouldContainSubstring, "结束日期不能早于开始日期")
	})
}

func TestHistoryElemToMessageIncludesTopicID(t *testing.T) {
	Convey("历史回补消息携带话题 ID", t, func() {
		chat := model.Chat{ID: 10, ChatType: "supergroup", Title: "ja-netfilter", IsForum: true}
		elem := messagesquery.Elem{Msg: &tg.Message{
			ID:      77,
			Date:    1_700_000_000,
			Message: "hello",
			PeerID:  &tg.PeerChannel{ChannelID: 1680975844},
			ReplyTo: &tg.MessageReplyHeader{ReplyToMsgID: 458347, ReplyToTopID: 458347},
		}}

		item, ok := historyElemToMessage(chat, elem)

		So(ok, ShouldBeTrue)
		So(item.TelegramTopicID, ShouldEqual, 458347)
	})
}
