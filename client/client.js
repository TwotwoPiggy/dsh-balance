/**
 * dsh-balance — browser half (lazy-CJS 客户端 bundle)。
 *
 * 在 `conversation.composer.dock`(输入框下方、命中率/输入输出 token 统计条所在行)
 * 注册一枚余额读数:
 *   - 余额: 单例轮询器按服务器下发的 `clientPollIntervalMs` 读取 `/query-balance`
 *     (只读缓存, 不直接访问 DeepSeek); 页面隐藏时暂停轮询。
 *   - 本会话消耗: 读取宿主推送的 `queryBalanceCost` 投影(按模型计价)。
 *
 * 布局: dock 条目的 DOM 是统计条块的下一个兄弟; 组件测量前一个兄弟(统计条)的高度,
 * 用负 margin 把自己拉回同一行并右对齐 —— 与统计条同一行显示。
 */
window.__ModuleLoader__.load({
	id: "dsh-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region styles
		const CSS_ID = "dsh-balance/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				"@keyframes dshqb-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.4);opacity:1}}",
				".dshqb_root{display:flex;align-items:center;justify-content:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin:0 auto;font-size:12px;line-height:20px;overflow:visible}",
				".dshqb_joined{margin-top:0;justify-content:flex-end}",
				".dshqb_sep{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-separator-primary);margin:0 10px;user-select:none}",
				".dshqb_trigger{position:relative;display:inline-flex;align-items:center;cursor:default}",
				".dshqb_amount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;display:inline-flex;align-items:center}",
				".dshqb_error{color:var(--dsw-alias-state-error-primary);display:inline-flex;align-items:center}",
				".dshqb_dot{display:block;width:7px;height:7px;border-radius:50%;margin-right:6px;flex-shrink:0;transition:background-color .2s ease,box-shadow .2s ease,transform .2s ease}",
				".dshqb_dot_btn{cursor:pointer;border:none;padding:0;background:transparent;outline:none;display:inline-flex;align-items:center;justify-content:center;line-height:1}",
				".dshqb_dot_btn:hover{transform:scale(1.35)}",
				".dshqb_dot_btn:active{transform:scale(0.95)}",
				".dshqb_dot_loading{animation:dshqb-pulse .7s ease-in-out infinite}",
				".dshqb_dot_success{background-color:var(--dsw-alias-state-success-primary,#10b981);box-shadow:0 0 0 2px rgba(16,185,129,0.2)}",
				".dshqb_dot_warning{background-color:var(--dsw-alias-state-warning-primary,#f59e0b);box-shadow:0 0 0 2px rgba(245,158,11,0.2)}",
				".dshqb_dot_danger{background-color:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 0 2px rgba(239,68,68,0.2)}",
				".dshqb_popover{position:absolute;bottom:calc(100% + 8px);left:50%;right:auto;z-index:9999;min-width:440px;max-width:92vw;background:var(--dsw-alias-surface-elevated,#1e1e24);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,0.08));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.45),0 2px 6px rgba(0,0,0,0.25);padding:14px 16px;display:flex;flex-direction:row;gap:16px;box-sizing:border-box;white-space:normal;text-align:left;color:var(--dsw-alias-label-primary,#f3f4f6);font-size:12px;line-height:1.5;backdrop-filter:blur(16px);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity .18s cubic-bezier(0.16,1,0.3,1),transform .18s cubic-bezier(0.16,1,0.3,1)}",
				".dshqb_popover::after{content:'';position:absolute;top:100%;left:0;right:0;height:12px;background:transparent}",
				".dshqb_trigger:hover .dshqb_popover, .dshqb_popover:hover{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}",
				".dshqb_col{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}",
				".dshqb_vsep{width:1px;background:var(--dsw-alias-separator-primary,rgba(255,255,255,0.1));align-self:stretch;margin:0 2px}",
				".dshqb_card_header{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af)}",
				".dshqb_card_badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;line-height:14px}",
				".dshqb_card_badge_success{background:rgba(16,185,129,0.15);color:#10b981}",
				".dshqb_card_badge_warning{background:rgba(245,158,11,0.15);color:#f59e0b}",
				".dshqb_card_badge_danger{background:rgba(239,68,68,0.15);color:#ef4444}",
				".dshqb_card_badge_info{background:rgba(59,130,246,0.15);color:#60a5fa}",
				".dshqb_card_row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px}",
				".dshqb_card_val_main{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#fff);font-variant-numeric:tabular-nums}",
				".dshqb_card_sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);display:flex;gap:8px}",
				".dshqb_card_models{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af);display:flex;flex-direction:column;gap:2px}",
				".dshqb_card_models li{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}",
				".dshqb_card_hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);margin-top:auto;padding-top:6px;border-top:1px dashed var(--dsw-alias-separator-primary,rgba(255,255,255,0.08))}",
				".dshqb_pricing_wrap{position:relative;display:inline-flex;align-items:center}",
				".dshqb_pricing{color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0 2px;border-radius:999px;text-decoration:none;line-height:1}",
				".dshqb_pricing svg{display:block}",
				".dshqb_pricing:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
				".dshqb_pricing_popover{position:absolute;bottom:calc(100% + 8px);left:50%;right:auto;z-index:9999;min-width:320px;max-width:92vw;background:var(--dsw-alias-surface-elevated,#1e1e24);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,0.08));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.45),0 2px 6px rgba(0,0,0,0.25);padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;white-space:normal;text-align:left;color:var(--dsw-alias-label-primary,#f3f4f6);font-size:12px;line-height:1.5;backdrop-filter:blur(16px);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity .18s cubic-bezier(0.16,1,0.3,1),transform .18s cubic-bezier(0.16,1,0.3,1)}",
				".dshqb_pricing_popover::after{content:'';position:absolute;top:100%;left:0;right:0;height:12px;background:transparent}",
				".dshqb_pricing_wrap:hover .dshqb_pricing_popover, .dshqb_pricing_popover:hover{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}",
				".dshqb_pricing_models{display:flex;flex-direction:column;gap:6px}",
				".dshqb_pricing_card_item{background:rgba(255,255,255,0.03);border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,0.06));border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:3px}",
				".dshqb_pricing_model_name{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary,#fff);font-variant-numeric:tabular-nums}",
				".dshqb_pricing_rates{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af);display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}",
				".dshqb_pricing_dot{color:var(--dsw-alias-separator-primary,rgba(255,255,255,0.2))}",
				".dshqb_pricing_link{color:var(--dsw-alias-accent-primary,#3b82f6);text-decoration:none;font-size:11px;display:inline-flex;align-items:center;margin-top:2px}",
				".dshqb_pricing_link:hover{text-decoration:underline}"
			].join("\n");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€" };
		const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] ?? currency + " ";
		/** 余额/花费显示: 0 显示 2 位, 大额 2 位小数, 小额 3~4 位。 */
		function formatMoney(amount, currency) {
			if (amount === 0) return currencySymbol(currency) + "0.00";
			const fixed = amount >= 1 ? 2 : amount >= 0.01 ? 3 : 4;
			return currencySymbol(currency) + amount.toFixed(fixed);
		}
		/** 紧凑 token 数: 517 / 12.2K / 517K / 1.2M。 */
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}
		function formatClock(ms) {
			if (ms <= 0) return "—";
			return new Date(ms).toLocaleTimeString();
		}
		/** 单价显示: 整数去尾零(¥2 / ¥8), 小数保留 ≤3 位(¥0.2)。 */
		function formatPrice(n, currency) {
			const num = Number(n);
			if (!Number.isFinite(num)) return currencySymbol(currency) + "?";
			return currencySymbol(currency) + (num % 1 === 0 ? String(num) : String(Math.round(num * 1000) / 1000));
		}
		/** 余额状态等级判定 (充足 success / 偏低 warning / 告急 danger) */
		function getStatusLevel(total, isAvailable, thresholds) {
			if (!isAvailable) return "danger";
			const danger = typeof thresholds?.danger === "number" ? thresholds.danger : 5;
			const warning = typeof thresholds?.warning === "number" ? thresholds.warning : 10;
			if (total < danger) return "danger";
			if (total < warning) return "warning";
			return "success";
		}
		/** 官方定价页(用户可自行更换为目标语言页面)。 */
		const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
		//#endregion

		//#region balance store (单例轮询器: 全页面共享一个 fetch 循环)
		const DEFAULT_POLL_MS = 30000;
		let snapshot = { status: "loading", isRefreshing: false };
		const listeners = new Set();
		let timer = null;
		let pollMs = DEFAULT_POLL_MS;
		let inflight = null;
		let started = false;

		function notify() {
			for (const fn of [...listeners]) fn();
		}

		async function refresh(force = false) {
			if (inflight !== null) return inflight;
			if (force && snapshot.isRefreshing !== true) {
				snapshot = { ...snapshot, isRefreshing: true };
				notify();
			}
			inflight = (async () => {
				try {
					const url = force ? "/query-balance?force=1" : "/query-balance";
					const res = await fetch(url, {
						cache: "no-store",
						headers: { accept: "application/json" }
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const data = await res.json();
					if (typeof data.clientPollIntervalMs === "number" && data.clientPollIntervalMs >= 5000) {
						pollMs = Math.min(data.clientPollIntervalMs, 3600000);
					}
					snapshot = { status: "ok", payload: data, at: Date.now(), isRefreshing: false };
				} catch (error) {
					snapshot = {
						status: "error",
						message: error instanceof Error ? error.message : String(error),
						at: Date.now(),
						isRefreshing: false
					};
				}
				inflight = null;
				notify();
			})();
			return inflight;
		}

		function schedule() {
			if (timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				if (document.hidden) return; // 页面隐藏时暂停; 由 visibilitychange 恢复
				refresh().then(schedule, schedule);
			}, pollMs);
		}

		const balanceStore = {
			subscribe(fn) {
				listeners.add(fn);
				if (!started) {
					started = true;
					refresh().then(schedule, schedule);
				}
				return () => {
					listeners.delete(fn);
					if (listeners.size === 0) {
						started = false;
						if (timer !== null) {
							clearTimeout(timer);
							timer = null;
						}
					}
				};
			},
			getSnapshot() {
				return snapshot;
			},
			forceRefresh() {
				return refresh(true);
			}
		};
		//#endregion

		//#region locale
		const NS = "queryBalance";
		const zh = {
			"balance": "余额 {amount}",
			"balanceError": "余额不可用",
			"balanceMissing": "未配置 API Key",
			"status.sufficient": "充足",
			"status.warning": "偏低",
			"status.danger": "告急",
			"btn.refresh": "点击立即刷新余额",
			"btn.refreshing": "正在刷新余额...",
			"sessionCost": "本会话约 {amount}",
			"card.balanceTitle": "📊 账户余额",
			"card.sessionTitle": "⚡ 本会话消耗",
			"card.total": "总额: ",
			"card.topup": "充值 {amount}",
			"card.granted": "赠送 {amount}",
			"card.updated": "更新于 {time} · 每 {interval} 刷新",
			"card.refreshHint": "💡 点击状态指示灯可立即手动刷新",
			"card.tokens": "Token: 输入 {input} · 输出 {output}",
			"card.noCost": "本会话暂未产生消耗",
			"card.pricingHint": "💡 计价规则与单价请见右侧 [?]",
			"card.error": "【账户余额】异常: {error}",
			"pricing.title": "📋 DeepSeek V4 定价参考",
			"pricing.rateBadge": "每 1M tokens · {currency}",
			"pricing.hit": "命中 {price}",
			"pricing.miss": "未命中 {price}",
			"pricing.output": "输出 {price}",
			"pricing.link": "查看官方完整定价页 ›",
			"pricing.aria": "查看 DeepSeek 定价策略",
			"model.unknown": "未知模型",
			"model.other": "其他模型",
			"unit.minutes": "{n} 分钟",
			"unit.seconds": "{n} 秒"
		};
		const en = {
			"balance": "Balance {amount}",
			"balanceError": "Balance unavailable",
			"balanceMissing": "API key not configured",
			"status.sufficient": "Sufficient",
			"status.warning": "Low",
			"status.danger": "Critical",
			"btn.refresh": "Click to refresh balance",
			"btn.refreshing": "Refreshing balance...",
			"sessionCost": "~{amount} this session",
			"card.balanceTitle": "📊 Account Balance",
			"card.sessionTitle": "⚡ Session Cost",
			"card.total": "Total: ",
			"card.topup": "Topped up {amount}",
			"card.granted": "Granted {amount}",
			"card.updated": "Updated {time} · Every {interval}",
			"card.refreshHint": "💡 Click status dot to refresh",
			"card.tokens": "Tokens: In {input} · Out {output}",
			"card.noCost": "No tokens consumed yet",
			"card.pricingHint": "💡 View pricing rules via [?] icon",
			"card.error": "【Account Balance】Error: {error}",
			"pricing.title": "📋 DeepSeek V4 Pricing",
			"pricing.rateBadge": "Per 1M tokens · {currency}",
			"pricing.hit": "Hit {price}",
			"pricing.miss": "Miss {price}",
			"pricing.output": "Out {price}",
			"pricing.link": "View official pricing details ›",
			"pricing.aria": "View DeepSeek pricing",
			"model.unknown": "unknown model",
			"model.other": "other models",
			"unit.minutes": "{n} min",
			"unit.seconds": "{n} s"
		};
		//#endregion

		//#region component
		function formatInterval(ms, t) {
			const minutes = Math.round(ms / 60000);
			return minutes >= 1 ? t("unit.minutes", { n: minutes }) : t("unit.seconds", { n: Math.round(ms / 1000) });
		}

		/**
		 * 余额读数: 与统计条同行的右对齐读数。
		 * 采用精致的左右双栏卡片悬停弹窗与风格统一的 V4 定价弹窗。
		 */
		const BalanceReadout = react.memo(function BalanceReadout({ useProjection, t }) {
			const cost = useProjection("queryBalanceCost");
			const balance = react.useSyncExternalStore(balanceStore.subscribe, balanceStore.getSnapshot, balanceStore.getSnapshot);
			const rootRef = react.useRef(null);

			const isRefreshing = balance.isRefreshing === true;
			const handleRefresh = (e) => {
				e.stopPropagation();
				e.preventDefault();
				void balanceStore.forceRefresh();
			};

			let balNode = null;
			let leftCol = null;

			// 1. 账户余额读数节点与左栏卡片内容
			if (balance.status === "ok") {
				const info = balance.payload;
				if (info.ok === true && Array.isArray(info.balances) && info.balances.length > 0) {
					const primary = info.balances[0];
					const amount = formatMoney(primary.total, primary.currency);
					const level = getStatusLevel(primary.total, info.isAvailable === true, info.thresholds);
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot, t("balance", { amount }));

					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { key: "title" }, t("card.balanceTitle")),
							react.createElement("span", { className: "dshqb_card_badge dshqb_card_badge_" + level, key: "badge" }, "● " + levelText)
						]),
						react.createElement("div", { className: "dshqb_card_row", key: "row" }, [
							react.createElement("span", { key: "lbl" }, t("card.total")),
							react.createElement("span", { className: "dshqb_card_val_main", key: "val" }, formatMoney(primary.total, primary.currency))
						]),
						react.createElement("div", { className: "dshqb_card_sub", key: "sub" }, [
							react.createElement("span", { key: "top" }, t("card.topup", { amount: formatMoney(primary.toppedUp, primary.currency) })),
							react.createElement("span", { key: "sep" }, "·"),
							react.createElement("span", { key: "gra" }, t("card.granted", { amount: formatMoney(primary.granted, primary.currency) }))
						]),
						react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
							react.createElement("div", { key: "time" }, t("card.updated", { time: formatClock(info.fetchedAt), interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t) })),
							react.createElement("div", { key: "tip" }, t("card.refreshHint"))
						])
					]);
				} else {
					const message = info.error === "api-key-missing" ? t("balanceMissing") : t("balanceError");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, message);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, t("card.balanceTitle")),
						react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t("card.error", { error: typeof info.error === "string" ? info.error : message }))
					]);
				}
			} else if (balance.status === "error") {
				const statusDot = react.createElement("button", {
					type: "button",
					className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
					"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
					title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
					onClick: handleRefresh,
					disabled: isRefreshing
				});
				balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, t("balanceError"));
				leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
					react.createElement("div", { className: "dshqb_card_header", key: "head" }, t("card.balanceTitle")),
					react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t("card.error", { error: balance.message }))
				]);
			}

			// 2. 本会话消耗读数节点与右栏卡片内容
			let costNode = null;
			const hasCost = cost !== undefined && cost.cost > 0;
			if (hasCost) {
				const amount = formatMoney(cost.cost, cost.currency ?? "CNY");
				costNode = react.createElement("span", { className: "dshqb_amount", key: "cost" }, t("sessionCost", { amount }));
			}

			const rightCol = react.createElement("div", { className: "dshqb_col", key: "right" }, [
				react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
					react.createElement("span", { key: "title" }, t("card.sessionTitle")),
					react.createElement("span", { className: "dshqb_card_val_main", key: "val" }, hasCost ? formatMoney(cost.cost, cost.currency ?? "CNY") : formatMoney(0, cost?.currency ?? "CNY"))
				]),
				hasCost
					? react.createElement("ul", { className: "dshqb_card_models", key: "models" },
						(cost.models ?? []).filter((m) => (cost.costByModel[m] ?? 0) > 0).map((m, i) =>
							react.createElement("li", { key: i }, [
								react.createElement("span", { key: "m" }, "• " + (m === "unknown" ? t("model.unknown") : m)),
								react.createElement("span", { key: "c" }, formatMoney(cost.costByModel[m], cost.currency ?? "CNY"))
							])
						)
					)
					: react.createElement("div", { className: "dshqb_card_sub", key: "models" }, t("card.noCost")),
				react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
					hasCost
						? react.createElement("div", { key: "tok" }, t("card.tokens", {
							input: formatTokens(cost.tokens.uncachedInput + cost.tokens.cacheRead + cost.tokens.cacheWrite),
							output: formatTokens(cost.tokens.output)
						}))
						: null,
					react.createElement("div", { key: "tip" }, t("card.pricingHint"))
				])
			]);

			// 3. 定价策略 "?" 图标与毛玻璃卡片 (只展示 DeepSeek V4 系列)
			let pricingNode = null;
			if (balance.status === "ok" && balance.payload !== null) {
				const payload = balance.payload;
				const currency = typeof payload.currency === "string" ? payload.currency : "CNY";
				const prices = payload.prices !== null && typeof payload.prices === "object" ? payload.prices : {};
				
				// 仅筛选 DeepSeek V4 系列模型
				const v4Entries = Object.entries(prices).filter(([model]) =>
					model.toLowerCase().includes("v4")
				);
				const entriesToShow = v4Entries.length > 0 ? v4Entries : Object.entries(prices);

				const pricingPopover = react.createElement("div", {
					className: "dshqb_pricing_popover",
					key: "pricing_popover"
				}, [
					react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
						react.createElement("span", { key: "title" }, t("pricing.title")),
						react.createElement("span", { className: "dshqb_card_badge dshqb_card_badge_info", key: "badge" }, t("pricing.rateBadge", { currency }))
					]),
					react.createElement("div", { className: "dshqb_pricing_models", key: "models" },
						entriesToShow.map(([model, p], idx) =>
							react.createElement("div", { className: "dshqb_pricing_card_item", key: idx }, [
								react.createElement("div", { className: "dshqb_pricing_model_name", key: "name" }, "• " + model),
								react.createElement("div", { className: "dshqb_pricing_rates", key: "rates" }, [
									react.createElement("span", { key: "hit" }, t("pricing.hit", { price: formatPrice(p.cacheHit, currency) })),
									react.createElement("span", { className: "dshqb_pricing_dot", key: "d1" }, "·"),
									react.createElement("span", { key: "miss" }, t("pricing.miss", { price: formatPrice(p.cacheMiss, currency) })),
									react.createElement("span", { className: "dshqb_pricing_dot", key: "d2" }, "·"),
									react.createElement("span", { key: "out" }, t("pricing.output", { price: formatPrice(p.output, currency) }))
								])
							])
						)
					),
					react.createElement("a", {
						className: "dshqb_pricing_link",
						key: "link",
						href: PRICING_URL,
						target: "_blank",
						rel: "noreferrer"
					}, t("pricing.link"))
				]);

				pricingNode = react.createElement("span", {
					className: "dshqb_pricing_wrap",
					key: "pricing_wrap"
				}, [
					react.createElement("a", {
						className: "dshqb_pricing",
						key: "btn",
						href: PRICING_URL,
						target: "_blank",
						rel: "noreferrer",
						"aria-label": t("pricing.aria"),
						title: t("pricing.aria"),
						children: react.createElement(_ui_primitives.IconQuestionOutline14, { size: 14 })
					}),
					pricingPopover
				]);
			}

			if (balNode === null && costNode === null && pricingNode === null) return null;

			const popover = leftCol !== null ? react.createElement("div", {
				className: "dshqb_popover",
				key: "popover"
			}, [
				leftCol,
				react.createElement("div", { className: "dshqb_vsep", key: "vsep" }),
				rightCol
			]) : null;

			const triggerChildren = [];
			if (balNode !== null) triggerChildren.push(balNode);
			if (costNode !== null) {
				triggerChildren.push(react.createElement("span", { className: "dshqb_sep", "aria-hidden": true, key: "sep_cost" }, "|"));
				triggerChildren.push(costNode);
			}
			if (popover !== null) triggerChildren.push(popover);

			const triggerWrapper = react.createElement("span", {
				className: "dshqb_trigger",
				key: "trigger"
			}, triggerChildren);

			const rootChildren = [triggerWrapper];
			if (pricingNode !== null) {
				rootChildren.push(react.createElement("span", { className: "dshqb_sep", "aria-hidden": true, key: "sep_pricing" }, "|"));
				rootChildren.push(pricingNode);
			}

			return react.createElement("div", {
				ref: rootRef,
				className: "dshqb_root",
				children: rootChildren
			});
		});
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-balance: dictionaries");
			// 等待 ui-conversation 声明 composer.dock 槽位后再注册本条目。
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "dsh-balance",
					order: 1,
					locale: NS
				}, BalanceReadout);
				return () => {
					dispose();
				};
			});
			// 页面回到前台时立即刷新一次, 并在隐藏期间跳过定时器。
			ctx.effect(() => {
				const onVisibility = () => {
					if (!document.hidden) refresh().then(schedule, schedule);
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => document.removeEventListener("visibilitychange", onVisibility);
			}, "dsh-balance: visibility resume");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
