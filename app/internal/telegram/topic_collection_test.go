package telegram

import (
	"testing"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	. "github.com/smartystreets/goconvey/convey"
)

func TestShouldStoreTopicMessage(t *testing.T) {
	Convey("非论坛群组不应用话题开关", t, func() {
		So(shouldStoreTopicMessage(model.Chat{ChatType: "supergroup"}, model.ChatTopic{}, false), ShouldBeTrue)
	})

	Convey("论坛群组必须同时启用父群和话题", t, func() {
		chat := model.Chat{IsForum: true}
		So(shouldStoreTopicMessage(chat, model.ChatTopic{Enabled: false}, true), ShouldBeFalse)
		So(shouldStoreTopicMessage(chat, model.ChatTopic{Enabled: true}, false), ShouldBeTrue)
		So(shouldStoreTopicMessage(chat, model.ChatTopic{Enabled: true}, true), ShouldBeTrue)
	})

	Convey("论坛群组尚未解析话题时保留消息而不是丢弃", t, func() {
		So(shouldStoreTopicMessage(model.Chat{IsForum: true}, model.ChatTopic{}, false), ShouldBeTrue)
	})
}
