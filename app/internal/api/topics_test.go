package api

import (
	"net/http"
	"testing"
)

// TestTopicRoutesRegistered 直接检查 mux 是否认识话题路由，避免触发认证中间件。
func TestTopicRoutesRegistered(t *testing.T) {
	router := (&Router{}).routes()
	for _, testCase := range []struct {
		method string
		path   string
		want   string
	}{
		{http.MethodPost, "/api/chats/1/topics/sync", "POST /api/chats/{chatID}/topics/sync"},
		{http.MethodPatch, "/api/chats/1/topics/2", "PATCH /api/chats/{chatID}/topics/{topicID}"},
		{http.MethodPost, "/api/chats/1/topics/2/backfill", "POST /api/chats/{chatID}/topics/{topicID}/backfill"},
	} {
		req, err := http.NewRequest(testCase.method, testCase.path, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, pattern := router.Handler(req)
		if pattern != testCase.want {
			t.Fatalf("%s %s matched %q, want %q", testCase.method, testCase.path, pattern, testCase.want)
		}
	}
}
