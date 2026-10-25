package scheduler

import (
	"testing"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	. "github.com/smartystreets/goconvey/convey"
)

func TestSummaryScopesForChat(t *testing.T) {
	Convey("普通群组只生成整群摘要", t, func() {
		scopes := summaryScopesForChat(model.Chat{ID: 1, SummaryEnabled: true})
		So(len(scopes), ShouldEqual, 1)
		So(scopes[0].TopicID, ShouldEqual, 0)
	})

	Convey("论坛群组只生成启用摘要的话题", t, func() {
		scopes := summaryScopesForChat(model.Chat{
			ID: 10, IsForum: true, SummaryEnabled: true,
			Topics: []model.ChatTopic{
				{ID: 1, Enabled: true, SummaryEnabled: true, Title: "Technical"},
				{ID: 2, Enabled: true, SummaryEnabled: false, Title: "Roleplay"},
				{ID: 3, Enabled: false, SummaryEnabled: true, Title: "Disabled"},
				{ID: 4, Enabled: true, SummaryEnabled: true, Title: "General", IsDeleted: true},
			},
		})
		So(len(scopes), ShouldEqual, 1)
		So(scopes[0].TopicID, ShouldEqual, 1)
		So(scopes[0].TopicTitle, ShouldEqual, "Technical")
	})

	Convey("论坛群整群摘要开关关闭时不生成任何话题摘要", t, func() {
		scopes := summaryScopesForChat(model.Chat{
			ID: 10, IsForum: true, SummaryEnabled: false,
			Topics: []model.ChatTopic{{ID: 1, Enabled: true, SummaryEnabled: true}},
		})
		So(scopes, ShouldBeEmpty)
	})
}
