"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
	AppSettings,
	Chat,
	BotSummaryDeliveryMode,
	Summary,
	SummarySearchFilters,
	SummaryStats,
} from "@/lib/types";
import {
	DashboardPage,
	MetricCard,
	MetricRail,
} from "@/components/dashboard-page";
import {
	DeliveryFilter,
	SummaryFilter,
	SummaryListSection,
	localDateInputValue,
} from "@/components/summaries-panel-sections";
import { SummaryDrawerPair } from "@/components/summary-drawer-pair";
import { CatchUpExperience } from "@/components/catch-up-experience";
import { DailyDigestExperience } from "@/components/daily-digest-experience";
import { useToast } from "@/components/toast";
import { SummaryRecovery } from "@/components/summary-recovery";

const summaryPageSize = 20;

export function SummariesPanel({ initialChatId = "all" }: { initialChatId?: string }) {
	const [summaries, setSummaries] = useState<Summary[]>([]);
	const [summaryStats, setSummaryStats] = useState<SummaryStats>({
		total: 0,
		successCount: 0,
		processingCount: 0,
		failedCount: 0,
	});
	const [allChats, setAllChats] = useState<Chat[]>([]);
	const [chats, setChats] = useState<Chat[]>([]);
	const [botReady, setBotReady] = useState(false);
	const [botConfigured, setBotConfigured] = useState<boolean | null>(null);
	const [botSummaryDeliveryMode, setBotSummaryDeliveryMode] = useState<BotSummaryDeliveryMode>("per_chat");
	const [summaryRetryLimit, setSummaryRetryLimit] = useState(4);
	const [defaultTimezone, setDefaultTimezone] = useState("Asia/Shanghai");
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const urlQ = searchParams.get("q") || "";
	const urlChatId = searchParams.get("chatId") || initialChatId;
	const urlTopicId = searchParams.get("topicId") || "all";
	const urlStatus = (searchParams.get("status") as SummaryFilter) || "all";
	const urlDelivery = (searchParams.get("delivery") as DeliveryFilter) || "all";
	const urlDateFrom = searchParams.get("dateFrom") || "";
	const urlDateTo = searchParams.get("dateTo") || "";
	const urlPage = Number(searchParams.get("page")) || 1;
	const urlSummaryId = searchParams.get("summaryId") ? Number(searchParams.get("summaryId")) : null;

	const [selectedSummaryId, setSelectedSummaryId] = useState<number | null>(urlSummaryId);
	const [externalSummary, setExternalSummary] = useState<Summary | null>(null);
	const [detailOpen, setDetailOpen] = useState(Boolean(urlSummaryId));
	const [selectedChatId, setSelectedChatId] = useState("");
	const [selectedTopicId, setSelectedTopicId] = useState("0");
	const [manualDate, setManualDate] = useState(localDateInputValue());
	const [filter, setFilter] = useState<SummaryFilter>(urlStatus);
	const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>(urlDelivery);
	const [query, setQuery] = useState(urlQ);
	const [chatFilter, setChatFilter] = useState(urlChatId);
	const [topicFilter, setTopicFilter] = useState(urlTopicId);
	const [dateFrom, setDateFrom] = useState(urlDateFrom);
	const [dateTo, setDateTo] = useState(urlDateTo);
	const [page, setPage] = useState(urlPage);
	const [pageSize] = useState(summaryPageSize);
	const [total, setTotal] = useState(0);
	const [manualEditorOpen, setManualEditorOpen] = useState(false);
	const deferredQuery = useDeferredValue(query);
	const loadRef = useRef<() => Promise<void>>(async () => {});
	const loadStatsRef = useRef<() => Promise<void>>(async () => {});
	const summaryListRef = useRef<HTMLDivElement | null>(null);
	const toast = useToast();

	const searchFilters = useMemo<SummarySearchFilters>(
		() => ({
			q: deferredQuery.trim(),
			chatId: chatFilter,
			topicId: topicFilter,
			status: filter,
			delivery: deliveryFilter,
			dateFrom,
			dateTo,
			page,
			pageSize,
		}),
		[chatFilter, topicFilter, dateFrom, dateTo, deferredQuery, deliveryFilter, filter, page, pageSize],
	);

	useEffect(() => {
		void loadMeta();
		void loadStats();
	}, []);

	useEffect(() => {
		void loadRef.current();
	}, [searchFilters]);

	useEffect(() => {
		setPage(1);
	}, [deferredQuery, chatFilter, topicFilter, filter, deliveryFilter, dateFrom, dateTo]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (deferredQuery) params.set("q", deferredQuery); else params.delete("q");
		if (chatFilter !== "all") params.set("chatId", chatFilter); else params.delete("chatId");
		if (topicFilter !== "all") params.set("topicId", topicFilter); else params.delete("topicId");
		if (filter !== "all") params.set("status", filter); else params.delete("status");
		if (deliveryFilter !== "all") params.set("delivery", deliveryFilter); else params.delete("delivery");
		if (dateFrom) params.set("dateFrom", dateFrom); else params.delete("dateFrom");
		if (dateTo) params.set("dateTo", dateTo); else params.delete("dateTo");
		if (page > 1) params.set("page", String(page)); else params.delete("page");
		if (selectedSummaryId && detailOpen) params.set("summaryId", String(selectedSummaryId)); else params.delete("summaryId");
		const qs = params.toString();
		window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
	}, [chatFilter, topicFilter, dateFrom, dateTo, deferredQuery, deliveryFilter, detailOpen, filter, page, pathname, selectedSummaryId]);

	useEffect(() => {
		if (summaries.length === 0 && !externalSummary) {
			setSelectedSummaryId(null);
			setDetailOpen(false);
			return;
		}
		if (!selectedSummaryId) {
			return;
		}
		if (
			!summaries.some((item) => item.id === selectedSummaryId) &&
			externalSummary?.id !== selectedSummaryId
		) {
			setSelectedSummaryId(null);
			setExternalSummary(null);
			setDetailOpen(false);
		}
	}, [externalSummary, selectedSummaryId, summaries]);

	const searchTerms = useMemo(() => {
		return deferredQuery
			.trim()
			.split(/\s+/)
			.map((item) => item.trim())
			.filter(Boolean);
	}, [deferredQuery]);

	const hasActiveSummaries = useMemo(() => {
		return (
			summaryStats.processingCount > 0 ||
			summaries.some((item) => item.status === "pending" || item.status === "running")
		);
	}, [summaries, summaryStats.processingCount]);

	async function loadMeta() {
		try {
			const [chatData, settingsData] = await Promise.all([api.listChats({ includeTopics: true }), api.settings()]);
			const manualChats = chatData.filter((chat) => chat.summaryEnabled);
			setAllChats(chatData);
			setChats(manualChats);
			applyBotDeliverySettings(settingsData);
			setSummaryRetryLimit(settingsData.summaryRetryLimit ?? 4);
			setDefaultTimezone(settingsData.defaultTimezone || "Asia/Shanghai");
			setSelectedChatId((current) => {
				if (current && manualChats.some((chat) => String(chat.id) === current)) {
					return current;
				}
				return manualChats[0] ? String(manualChats[0].id) : "";
			});
		} catch (err) {
			toast.showError(asMessage(err));
		}
	}

	/** 同步每日总览入口依赖的 Bot 配置和推送形式。 */
	function applyBotDeliverySettings(settings: AppSettings) {
		const configured = Boolean(settings.botToken?.trim()) && Boolean(settings.botTargetChatId?.trim());
		setBotConfigured(configured);
		setBotReady(settings.botEnabled && configured);
		setBotSummaryDeliveryMode(settings.botSummaryDeliveryMode || "per_chat");
	}

	async function loadStats() {
		try {
			setSummaryStats(await api.summaryStats());
		} catch (err) {
			toast.showError(asMessage(err));
		}
	}

	async function loadSummaries(filters: SummarySearchFilters) {
		try {
			const response = await api.listSummaries(filters);
			setSummaries(response.items);
			setTotal(response.total);
			setSelectedSummaryId((current) =>
				current && response.items.some((item) => item.id === current)
					? current
					: response.items[0]?.id ?? null,
			);
		} catch (err) {
			toast.showError(asMessage(err));
		}
	}
	loadRef.current = async () => loadSummaries(searchFilters);
	loadStatsRef.current = loadStats;

	useEffect(() => {
		if (!hasActiveSummaries) {
			return;
		}
		const timer = window.setInterval(() => {
			void loadRef.current();
			void loadStatsRef.current();
		}, 3000);
		return () => window.clearInterval(timer);
	}, [hasActiveSummaries]);

	async function runManual() {
		if (!selectedChatId || !manualDate) {
			return;
		}

		try {
			await api.runSummary(Number(selectedChatId), manualDate, Number(selectedTopicId));
			toast.showSuccess("已提交摘要生成任务。");
			setManualEditorOpen(false);
			await Promise.all([loadRef.current(), loadStatsRef.current()]);
		} catch (err) {
			toast.showError(asMessage(err));
		}
	}

	/** 将全局统计卡转换为独立的列表筛选入口，并让结果区域立即进入视野。 */
	function applyMetricFilter(nextFilter: SummaryFilter) {
		setQuery("");
		setChatFilter("all");
		setTopicFilter("all");
		setFilter(nextFilter);
		setDeliveryFilter("all");
		setDateFrom("");
		setDateTo("");
		setPage(1);
		window.requestAnimationFrame(() => {
			summaryListRef.current?.scrollIntoView({ block: "start" });
		});
	}

	const chatTitles = useMemo(() => {
		return new Map(allChats.map((chat) => [chat.id, chat.title]));
	}, [allChats]);

	const selectedManualChat = useMemo(
		() => allChats.find((chat) => String(chat.id) === selectedChatId) ?? null,
		[allChats, selectedChatId],
	);
	const manualTopicOptions = useMemo(() => {
		if (!selectedManualChat?.isForum) return [];
		return (selectedManualChat.topics ?? []).filter((topic) => topic.enabled && topic.summaryEnabled && !topic.isDeleted);
	}, [selectedManualChat]);

	const filterTopicOptions = useMemo(() => {
		const chat = allChats.find((item) => String(item.id) === chatFilter);
		if (!chat?.isForum) return [];
		return (chat.topics ?? []).filter((topic) => !topic.isDeleted);
	}, [allChats, chatFilter]);

	const selectedSummary = useMemo(
		() => summaries.find((item) => item.id === selectedSummaryId) ??
			(externalSummary?.id === selectedSummaryId ? externalSummary : null),
		[externalSummary, selectedSummaryId, summaries],
	);
	const selectedChat = useMemo(
		() => (selectedSummary ? allChats.find((item) => item.id === selectedSummary.chatId) ?? null : null),
		[allChats, selectedSummary],
	);

	const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
	const searching = Boolean(
		deferredQuery.trim() || chatFilter !== "all" || filter !== "all" || deliveryFilter !== "all" || dateFrom || dateTo,
	);

	return (
		<DashboardPage
			description="聚合每日总览、阶段回顾与单群摘要，支持关键词溯源与一键查验原始会话证据。"
			title="今日简报"
		>
			<div className="summary-rollup-grid">
				<DailyDigestExperience
					botConfigured={botConfigured}
					botReady={botReady}
					deliveryMode={botSummaryDeliveryMode}
					onChanged={() => loadRef.current()}
					onEnabled={applyBotDeliverySettings}
					onOpenSummary={(summary) => {
						setExternalSummary(summary);
						setSelectedSummaryId(summary.id);
						setDetailOpen(true);
					}}
				/>
				<CatchUpExperience
					botReady={botReady}
					chats={chats}
					onOpenSummary={(summary) => {
						setExternalSummary(summary);
						setSelectedSummaryId(summary.id);
						setDetailOpen(true);
					}}
					timezone={defaultTimezone}
				/>
			</div>
			<MetricRail compact>
				<MetricCard
					detail="已经写入数据库的摘要任务与结果。"
					label="摘要记录"
					onClick={() => applyMetricFilter("all")}
					value={summaryStats.total}
				/>
				<MetricCard
					detail="状态为 succeeded 的摘要数量。"
					label="生成成功"
					onClick={() => applyMetricFilter("succeeded")}
					value={summaryStats.successCount}
				/>
				<MetricCard
					detail="当前正在运行或等待完成的摘要。"
					label="处理中"
					onClick={() => applyMetricFilter("processing")}
					value={summaryStats.processingCount}
				/>
				<MetricCard
					actions={<SummaryRecovery onChanged={() => { void loadRef.current(); void loadStatsRef.current(); }} />}
					detail="失败任务建议重新执行，并检查模型配置或上下文限制。"
					label="生成失败"
					onClick={() => applyMetricFilter("failed")}
					value={summaryStats.failedCount}
				/>
			</MetricRail>

			<div ref={summaryListRef}>
				<SummaryListSection
					allChats={allChats}
					botReady={botReady}
					chatFilter={chatFilter}
					chatTitles={chatTitles}
					chats={chats}
					dateFrom={dateFrom}
					dateTo={dateTo}
					deliveryFilter={deliveryFilter}
					filter={filter}
					loadSummaryDate={manualDate}
					manualEditorOpen={manualEditorOpen}
					onChatFilterChange={(value) => {
						setChatFilter(value);
						setTopicFilter("all");
					}}
					onTopicFilterChange={setTopicFilter}
					topicFilter={topicFilter}
					topicFilterOptions={filterTopicOptions}
					onDateFromChange={setDateFrom}
					onDateToChange={setDateTo}
					onDeliveryFilterChange={setDeliveryFilter}
					onFilterChange={setFilter}
					onLoadSummaryDateChange={setManualDate}
					onManualEditorToggle={() => setManualEditorOpen((current) => !current)}
					onManualRun={runManual}
					onPageChange={setPage}
					onQueryChange={setQuery}
					onSelectedChatChange={(value) => {
						setSelectedChatId(value);
						setSelectedTopicId("0");
					}}
					onSelectedTopicChange={setSelectedTopicId}
					selectedTopicId={selectedTopicId}
					topicOptions={manualTopicOptions}
					onSelectSummary={(summaryId) => {
						setExternalSummary(null);
						setSelectedSummaryId(summaryId);
						setDetailOpen(true);
					}}
					page={page}
					query={query}
					searchTerms={searchTerms}
					searching={searching}
					selectedChatId={selectedChatId}
					selectedSummaryId={selectedSummaryId}
					summaries={summaries}
					total={total}
					totalPages={totalPages}
				/>
			</div>

			<SummaryDrawerPair
				botReady={botReady}
				chatTitle={selectedSummary ? chatTitles.get(selectedSummary.chatId) ?? "未知群组" : "未知群组"}
				onClose={() => setDetailOpen(false)}
				onRefresh={async () => {
					await Promise.all([loadRef.current(), loadStatsRef.current()]);
				}}
				open={detailOpen && Boolean(selectedSummary)}
				selectedChat={selectedChat}
				selectedSummary={selectedSummary}
				summaryRetryLimit={summaryRetryLimit}
			/>
		</DashboardPage>
	);
}

function asMessage(err: unknown) {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
