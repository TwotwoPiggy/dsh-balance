/**
 * dsh-balance-lite — browser half (lazy-CJS 客户端 bundle)。
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
	id: "dsh-balance-lite",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const CSS_ID = "dsh-balance-lite/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance-lite";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				"@keyframes dshqb-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.4);opacity:1}}",
				"@keyframes dshqb-fadein{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}",
				".dshqb_root{display:flex;align-items:center;justify-content:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin:0 auto;font-size:12px;line-height:20px;overflow:visible}",
				".dshqb_joined{margin-top:0;justify-content:flex-end}",
				".dshqb_sep{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.25)));margin:0 10px;user-select:none}",
				".dshqb_trigger{position:relative;display:inline-flex;align-items:center;cursor:default}",
				".dshqb_amount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;display:inline-flex;align-items:center}",
				".dshqb_error{color:var(--dsw-alias-state-error-primary,#ef4444);display:inline-flex;align-items:center}",
				".dshqb_dot{display:block;width:7px;height:7px;border-radius:50%;margin-right:6px;flex-shrink:0;transition:background-color .2s ease,box-shadow .2s ease,transform .2s ease}",
				".dshqb_dot_btn{cursor:pointer;border:none;padding:0;background:transparent;outline:none;display:inline-flex;align-items:center;justify-content:center;line-height:1}",
				".dshqb_dot_btn:hover{transform:scale(1.35)}",
				".dshqb_dot_btn:active{transform:scale(0.95)}",
				".dshqb_dot_loading{animation:dshqb-pulse .7s ease-in-out infinite}",
				".dshqb_dot_success{background-color:var(--dsw-alias-state-success-primary,#10b981);box-shadow:0 0 0 2px rgba(16,185,129,0.2)}",
				".dshqb_dot_warning{background-color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b));box-shadow:0 0 0 2px rgba(245,158,11,0.2)}",
				".dshqb_dot_danger{background-color:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 0 2px rgba(239,68,68,0.2)}",
				".dshqb_popover{position:absolute;bottom:calc(100% + 8px);left:50%;right:auto;z-index:9999;min-width:440px;max-width:92vw;background:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,var(--dsw-alias-surface-elevated,#ffffff)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:10px;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,0.18));padding:14px 16px;display:flex;flex-direction:row;gap:16px;box-sizing:border-box;white-space:normal;text-align:left;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;backdrop-filter:blur(16px);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity .18s cubic-bezier(0.16,1,0.3,1),transform .18s cubic-bezier(0.16,1,0.3,1)}",
				".dshqb_popover::after{content:'';position:absolute;top:100%;left:0;right:0;height:12px;background:transparent}",
				".dshqb_trigger:hover .dshqb_popover, .dshqb_popover:hover{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}",
				".dshqb_col{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}",
				".dshqb_vsep{width:1px;background:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.15)));align-self:stretch;margin:0 2px}",
				".dshqb_card_header{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}",
				".dshqb_card_badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;line-height:14px}",
				".dshqb_card_badge_success{background:rgba(16,185,129,0.12);color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_card_badge_warning{background:rgba(245,158,11,0.12);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_card_badge_danger{background:rgba(239,68,68,0.12);color:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_card_badge_info{background:rgba(59,130,246,0.12);color:var(--dsw-alias-brand-primary,#3b82f6)}",
				".dshqb_card_row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px}",
				".dshqb_card_val_main{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
				".dshqb_card_sub{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px}",
				".dshqb_card_models{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px}",
				".dshqb_card_models li{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}",
				".dshqb_card_hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:auto;padding-top:6px;border-top:1px dashed var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.15)));display:flex;flex-direction:column;gap:3px}",
				".dshqb_card_tokens{display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.35}",
				".dshqb_card_hit{font-size:10px;color:var(--dsw-alias-label-tertiary);opacity:0.9}"
			].join("\n");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€" };
		const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] ?? currency + " ";
		/** 余额/花费显示: 0 显示 2 位, 大额 2 位小数, 小额 3~4 位。 */
		function formatMoney(amount, currency) {
			if (typeof amount !== "number" || isNaN(amount)) return currencySymbol(currency) + "0.00";
			if (amount === 0) return currencySymbol(currency) + "0.00";
			const sign = amount < 0 ? "-" : "";
			const abs = Math.abs(amount);
			const fixed = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
			return sign + currencySymbol(currency) + abs.toFixed(fixed);
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
		/** 余额状态等级判定 (充足 success / 偏低 warning / 告急 danger) */
		function getStatusLevel(total, isAvailable, thresholds) {
			if (!isAvailable) return "danger";
			const danger = typeof thresholds?.danger === "number" ? thresholds.danger : 5;
			const warning = typeof thresholds?.warning === "number" ? thresholds.warning : 10;
			if (total < danger) return "danger";
			if (total < warning) return "warning";
			return "success";
		}
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
			"card.tokensHit": "命中: {hit} ({hitRate}%)",
			"card.noCost": "本会话暂未产生消耗",
			"card.error": "【账户余额】异常: {error}",
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
			"card.refreshHint": "💡 Click status dot to refresh instantly",
			"card.tokens": "Tokens: In {input} · Out {output}",
			"card.tokensHit": "Cache hit: {hit} ({hitRate}%)",
			"card.noCost": "No cost in this session yet",
			"card.error": "【Account Balance】Error: {error}",
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
		 * 包含余额指示灯、本会话消耗、悬停双栏卡片。
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
					const primary = info.balances.find((entry) => entry.currency === info.currency) ?? info.balances[0];
					const amount = formatMoney(primary.total, primary.currency);
					const currencyThresholds = info.thresholdsByCurrency?.[primary.currency] ?? info.thresholds;
					const level = getStatusLevel(primary.total, info.isAvailable === true, currencyThresholds);
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
						? (() => {
							const totalInput = (cost.tokens?.uncachedInput ?? 0) + (cost.tokens?.cacheRead ?? 0) + (cost.tokens?.cacheWrite ?? 0);
							const cacheHit = cost.tokens?.cacheRead ?? 0;
							const hitRate = totalInput > 0 ? (cacheHit / totalInput * 100).toFixed(1) : "0.0";
							return react.createElement("div", { className: "dshqb_card_tokens", key: "tok" }, [
								react.createElement("div", { key: "main" }, t("card.tokens", {
									input: formatTokens(totalInput),
									output: formatTokens(cost.tokens?.output ?? 0)
								})),
								cacheHit > 0
									? react.createElement("div", { className: "dshqb_card_hit", key: "hit" }, t("card.tokensHit", {
										hit: formatTokens(cacheHit),
										hitRate
									}))
									: null
							]);
						})()
						: null
				])
			]);

			if (balNode === null && costNode === null) return null;

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

			return react.createElement("div", {
				ref: rootRef,
				className: "dshqb_root",
				children: [triggerWrapper]
			});
		});
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-balance-lite: dictionaries");
			// 等待 ui-conversation 声明 composer.dock 槽位后再注册本条目。
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "dsh-balance-lite",
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
			}, "dsh-balance-lite: visibility resume");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
