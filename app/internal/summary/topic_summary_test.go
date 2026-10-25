package summary

import (
	"testing"

	"github.com/fr0der1c/tgtldr/app/internal/model"
	. "github.com/smartystreets/goconvey/convey"
)

func TestSummaryTopicScopeIdentity(t *testing.T) {
	Convey("话题摘要与整群摘要使用不同的唯一身份", t, func() {
		chatSummary := model.Summary{ChatID: 10, SummaryDate: "2026-10-25"}
		topicSummary := model.Summary{ChatID: 10, TopicID: 2, SummaryDate: "2026-10-25"}

		So(chatSummary.SummaryScopeKey(), ShouldEqual, "10:0:2026-10-25")
		So(topicSummary.SummaryScopeKey(), ShouldEqual, "10:2:2026-10-25")
		So(topicSummary.SummaryScopeKey(), ShouldNotEqual, chatSummary.SummaryScopeKey())
	})
}
