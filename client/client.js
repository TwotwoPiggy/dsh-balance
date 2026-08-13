/**
 * dsh-query-balance — browser half (lazy-CJS 客户端 bundle)。
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
		const CSS_ID = "dsh-query-balance/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-query-balance";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".dshqb_root{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;margin:0 auto;font-size:12px;line-height:20px;display:block;overflow:hidden}",
				".dshqb_joined{margin-top:0;text-align:right}",
				".dshqb_sep{color:var(--dsw-alias-separator-primary);margin:0 10px}",
				".dshqb_amount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
				".dshqb_error{color:var(--dsw-alias-state-error-primary)}",
				".dshqb_pricing{color:var(--dsw-alias-label-tertiary);vertical-align:-2px;display:inline-flex;align-items:center;margin-left:2px;padding:0 2px;border-radius:999px;text-decoration:none}",
				".dshqb_pricing:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}"
			].join("\n");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€" };
		const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] ?? currency + " ";
		/** 余额/花费显示: 大额 2 位小数, 小额 3~4 位。 */
		function formatMoney(amount, currency) {
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
		/** 官方定价页(用户可自行更换为目标语言页面)。 */
		const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
		//#endregion

		//#region balance store (单例轮询器: 全页面共享一个 fetch 循环)
		const DEFAULT_POLL_MS = 30000;
		let snapshot = { status: "loading" };
		const listeners = new Set();
		let timer = null;
		let pollMs = DEFAULT_POLL_MS;
		let inflight = null;
		let started = false;

		function notify() {
			for (const fn of [...listeners]) fn();
		}

		async function refresh() {
			if (inflight !== null) return inflight;
			inflight = (async () => {
				try {
					const res = await fetch("/query-balance", {
						cache: "no-store",
						headers: { accept: "application/json" }
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const data = await res.json();
					if (typeof data.clientPollIntervalMs === "number" && data.clientPollIntervalMs >= 5000) {
						pollMs = Math.min(data.clientPollIntervalMs, 3600000);
					}
					snapshot = { status: "ok", payload: data, at: Date.now() };
				} catch (error) {
					snapshot = {
						status: "error",
						message: error instanceof Error ? error.message : String(error),
						at: Date.now()
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
			}
		};
		//#endregion

		//#region locale
		const NS = "queryBalance";
		const zh = {
			"balance": "余额 {amount}",
			"balanceError": "余额不可用",
			"balanceMissing": "未配置 API Key",
			"sessionCost": "本会话约 {amount}",
			"tip.balance": "总额 {total} · 赠送 {granted} · 充值 {toppedUp}\n状态: {status}\n更新于 {time} · 每 {interval} 刷新",
			"tip.statusAvailable": "余额可用",
			"tip.statusUnavailable": "余额不足",
			"tip.cost": "本会话消耗(估算): {amount}\n{models}\n输入 {input} tok · 输出 {output} tok",
			"tip.costModel": "{model}: {amount}",
			"tip.error": "获取失败: {error}",
			"tip.pricing": "DeepSeek 定价(每 1M token · {currency})\n{models}\n点击查看官方定价页",
			"tip.pricingModel": "{model}: 命中 {hit} · 未命中 {miss} · 输出 {output}",
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
			"sessionCost": "~{amount} this session",
			"tip.balance": "Total {total} · granted {granted} · topped up {toppedUp}\nStatus: {status}\nUpdated {time} · every {interval}",
			"tip.statusAvailable": "available",
			"tip.statusUnavailable": "insufficient",
			"tip.cost": "This session (est.): {amount}\n{models}\nInput {input} tok · Output {output} tok",
			"tip.costModel": "{model}: {amount}",
			"tip.error": "Fetch failed: {error}",
			"tip.pricing": "DeepSeek pricing (per 1M tokens · {currency})\n{models}\nClick for the official pricing page",
			"tip.pricingModel": "{model}: cache hit {hit} · miss {miss} · output {output}",
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
		 * 用 MutationObserver + ResizeObserver 监测前一个兄弟(统计条)是否在场,
		 * 在场则用负 margin 拉回同一行(高度取自实测值, 不硬编码)。
		 */
		const BalanceReadout = react.memo(function BalanceReadout({ useProjection, t }) {
			const cost = useProjection("queryBalanceCost");
			const balance = react.useSyncExternalStore(balanceStore.subscribe, balanceStore.getSnapshot, balanceStore.getSnapshot);
			const rootRef = react.useRef(null);
			const [pricingHover, setPricingHover] = react.useState(false);


			const groups = [];
			const tooltipLines = [];

			if (balance.status === "ok") {
				const info = balance.payload;
				if (info.ok === true && Array.isArray(info.balances) && info.balances.length > 0) {
					const primary = info.balances[0];
					const amount = formatMoney(primary.total, primary.currency);
					groups.push(react.createElement("span", { className: "dshqb_amount", key: "bal" }, t("balance", { amount })));
					const status = info.isAvailable === true ? t("tip.statusAvailable") : t("tip.statusUnavailable");
					tooltipLines.push(t("tip.balance", {
						total: formatMoney(primary.total, primary.currency),
						granted: formatMoney(primary.granted, primary.currency),
						toppedUp: formatMoney(primary.toppedUp, primary.currency),
						status,
						time: formatClock(info.fetchedAt),
						interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t)
					}));
					if (info.stale === true && typeof info.error === "string") {
						tooltipLines.push(t("tip.error", { error: info.error }));
					}
				} else {
					const message = info.error === "api-key-missing" ? t("balanceMissing") : t("balanceError");
					groups.push(react.createElement("span", { className: "dshqb_error", key: "bal" }, message));
					if (typeof info.error === "string") tooltipLines.push(t("tip.error", { error: info.error }));
				}
			} else if (balance.status === "error") {
				groups.push(react.createElement("span", { className: "dshqb_error", key: "bal" }, t("balanceError")));
				tooltipLines.push(t("tip.error", { error: balance.message }));
			}

			if (cost !== undefined && cost.cost > 0) {
				const amount = formatMoney(cost.cost, cost.currency ?? "CNY");
				groups.push(react.createElement("span", { key: "cost" }, t("sessionCost", { amount })));
				const modelLines = (cost.models ?? [])
					.filter((model) => (cost.costByModel[model] ?? 0) > 0)
					.map((model) => t("tip.costModel", {
						model: model === "unknown" ? t("model.unknown") : model,
						amount: formatMoney(cost.costByModel[model], cost.currency ?? "CNY")
					}));
				tooltipLines.push(t("tip.cost", {
					amount,
					models: modelLines.length > 0 ? modelLines.join("\n") : "",
					input: formatTokens(cost.tokens.uncachedInput + cost.tokens.cacheRead + cost.tokens.cacheWrite),
					output: formatTokens(cost.tokens.output)
				}));
			}

			// "?" 图标: 悬停显示 DeepSeek 定价策略, 点击打开官方定价页。
			let pricingText = "";
			if (balance.status === "ok" && balance.payload !== null) {
				const payload = balance.payload;
				const currency = typeof payload.currency === "string" ? payload.currency : "CNY";
				const prices = payload.prices !== null && typeof payload.prices === "object" ? payload.prices : {};
				const defaults = payload.defaultPrices !== null && typeof payload.defaultPrices === "object" ? payload.defaultPrices : null;
				const modelLines = [];
				for (const [model, p] of Object.entries(prices)) {
					if (p !== null && typeof p === "object") {
						modelLines.push(t("tip.pricingModel", {
							model,
							hit: formatPrice(p.cacheHit, currency),
							miss: formatPrice(p.cacheMiss, currency),
							output: formatPrice(p.output, currency)
						}));
					}
				}
				if (defaults !== null) {
					modelLines.push(t("tip.pricingModel", {
						model: t("model.other"),
						hit: formatPrice(defaults.cacheHit, currency),
						miss: formatPrice(defaults.cacheMiss, currency),
						output: formatPrice(defaults.output, currency)
					}));
				}
				pricingText = t("tip.pricing", { currency, models: modelLines.join("\n") });
			}
			if (pricingText !== "") {
				groups.push(react.createElement(_ui_primitives.Tooltip, {
					key: "pricing",
					label: pricingText,
					side: "top",
					delayMs: 300,
					children: react.createElement("a", {
						className: "dshqb_pricing",
						href: PRICING_URL,
						target: "_blank",
						rel: "noreferrer",
						"aria-label": t("pricing.aria"),
						title: t("pricing.aria"),
						onMouseEnter: () => setPricingHover(true),
						onMouseLeave: () => setPricingHover(false),
						children: react.createElement(_ui_primitives.IconQuestionOutline14, { size: 14 })
					})
				}));
			}

			if (groups.length === 0) return null;

			const line = groups.map((node, i) => react.createElement(react.Fragment, { key: i }, i > 0 ? react.createElement("span", {
				className: "dshqb_sep",
				"aria-hidden": true
			}, "|") : null, node));

			return react.createElement(_ui_primitives.Tooltip, {
				label: tooltipLines.length > 0 ? tooltipLines.join("\n") : "",
				side: "top",
				delayMs: 500,
				disabled: tooltipLines.length === 0 || pricingHover,
				children: react.createElement("div", {
					ref: rootRef,
					className: "dshqb_root",
					children: line
				})
			});
		});
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "query-balance: dictionaries");
			// 等待 ui-conversation 声明 composer.dock 槽位后再注册本条目。
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "query-balance",
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
			}, "query-balance: visibility resume");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
