/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/_app";
exports.ids = ["pages/_app"];
exports.modules = {

/***/ "./src/lib/chains.ts":
/*!***************************!*\
  !*** ./src/lib/chains.ts ***!
  \***************************/
/***/ ((module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.a(module, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {\n__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   mezoTestnet: () => (/* binding */ mezoTestnet)\n/* harmony export */ });\n/* harmony import */ var viem__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! viem */ \"viem\");\nvar __webpack_async_dependencies__ = __webpack_handle_async_dependencies__([viem__WEBPACK_IMPORTED_MODULE_0__]);\nviem__WEBPACK_IMPORTED_MODULE_0__ = (__webpack_async_dependencies__.then ? (await __webpack_async_dependencies__)() : __webpack_async_dependencies__)[0];\n\nconst mezoTestnet = (0,viem__WEBPACK_IMPORTED_MODULE_0__.defineChain)({\n    id: 31611,\n    name: \"Mezo Testnet\",\n    nativeCurrency: {\n        name: \"tBTC\",\n        symbol: \"tBTC\",\n        decimals: 18\n    },\n    rpcUrls: {\n        default: {\n            http: [\n                \"https://rpc.test.mezo.org\" || 0\n            ]\n        },\n        public: {\n            http: [\n                \"https://rpc.test.mezo.org\" || 0\n            ]\n        }\n    }\n});\n\n__webpack_async_result__();\n} catch(e) { __webpack_async_result__(e); } });//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9zcmMvbGliL2NoYWlucy50cyIsIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFtQztBQUU1QixNQUFNQyxjQUFjRCxpREFBV0EsQ0FBQztJQUNyQ0UsSUFBSTtJQUNKQyxNQUFNO0lBQ05DLGdCQUFnQjtRQUFFRCxNQUFNO1FBQVFFLFFBQVE7UUFBUUMsVUFBVTtJQUFHO0lBQzdEQyxTQUFTO1FBQ1BDLFNBQVM7WUFDUEMsTUFBTTtnQkFBQ0MsMkJBQStCLElBQUk7YUFBNEI7UUFDeEU7UUFDQUcsUUFBUTtZQUNOSixNQUFNO2dCQUFDQywyQkFBK0IsSUFBSTthQUE0QjtRQUN4RTtJQUNGO0FBQ0YsR0FBRyIsInNvdXJjZXMiOlsid2VicGFjazovL3Ryb3ZlcGlsb3QtdWkvLi9zcmMvbGliL2NoYWlucy50cz84N2UwIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlZmluZUNoYWluIH0gZnJvbSAndmllbSc7XG5cbmV4cG9ydCBjb25zdCBtZXpvVGVzdG5ldCA9IGRlZmluZUNoYWluKHtcbiAgaWQ6IDMxNjExLFxuICBuYW1lOiAnTWV6byBUZXN0bmV0JyxcbiAgbmF0aXZlQ3VycmVuY3k6IHsgbmFtZTogJ3RCVEMnLCBzeW1ib2w6ICd0QlRDJywgZGVjaW1hbHM6IDE4IH0sXG4gIHJwY1VybHM6IHtcbiAgICBkZWZhdWx0OiB7XG4gICAgICBodHRwOiBbcHJvY2Vzcy5lbnYuTkVYVF9QVUJMSUNfUlBDX1VSTCB8fCAnaHR0cHM6Ly9ycGMudGVzdC5tZXpvLm9yZyddLFxuICAgIH0sXG4gICAgcHVibGljOiB7XG4gICAgICBodHRwOiBbcHJvY2Vzcy5lbnYuTkVYVF9QVUJMSUNfUlBDX1VSTCB8fCAnaHR0cHM6Ly9ycGMudGVzdC5tZXpvLm9yZyddLFxuICAgIH0sXG4gIH0sXG59KTtcbiJdLCJuYW1lcyI6WyJkZWZpbmVDaGFpbiIsIm1lem9UZXN0bmV0IiwiaWQiLCJuYW1lIiwibmF0aXZlQ3VycmVuY3kiLCJzeW1ib2wiLCJkZWNpbWFscyIsInJwY1VybHMiLCJkZWZhdWx0IiwiaHR0cCIsInByb2Nlc3MiLCJlbnYiLCJORVhUX1BVQkxJQ19SUENfVVJMIiwicHVibGljIl0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./src/lib/chains.ts\n");

/***/ }),

/***/ "./src/lib/wagmi.ts":
/*!**************************!*\
  !*** ./src/lib/wagmi.ts ***!
  \**************************/
/***/ ((module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.a(module, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {\n__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   wagmiConfig: () => (/* binding */ wagmiConfig)\n/* harmony export */ });\n/* harmony import */ var _rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @rainbow-me/rainbowkit */ \"@rainbow-me/rainbowkit\");\n/* harmony import */ var wagmi__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! wagmi */ \"wagmi\");\n/* harmony import */ var _chains__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./chains */ \"./src/lib/chains.ts\");\nvar __webpack_async_dependencies__ = __webpack_handle_async_dependencies__([_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_0__, wagmi__WEBPACK_IMPORTED_MODULE_1__, _chains__WEBPACK_IMPORTED_MODULE_2__]);\n([_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_0__, wagmi__WEBPACK_IMPORTED_MODULE_1__, _chains__WEBPACK_IMPORTED_MODULE_2__] = __webpack_async_dependencies__.then ? (await __webpack_async_dependencies__)() : __webpack_async_dependencies__);\n\n\n\nconst wagmiConfig = (0,_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_0__.getDefaultConfig)({\n    appName: \"TrovePilot\",\n    projectId: \"869f2d6ad3ac7d88f7d88487c590b82e\" || 0,\n    chains: [\n        _chains__WEBPACK_IMPORTED_MODULE_2__.mezoTestnet\n    ],\n    transports: {\n        [_chains__WEBPACK_IMPORTED_MODULE_2__.mezoTestnet.id]: (0,wagmi__WEBPACK_IMPORTED_MODULE_1__.http)(\"https://rpc.test.mezo.org\")\n    }\n});\n\n__webpack_async_result__();\n} catch(e) { __webpack_async_result__(e); } });//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9zcmMvbGliL3dhZ21pLnRzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBMEQ7QUFDN0I7QUFDVTtBQUVoQyxNQUFNRyxjQUFjSCx3RUFBZ0JBLENBQUM7SUFDMUNJLFNBQVM7SUFDVEMsV0FBV0Msa0NBQXFDLElBQUk7SUFDcERHLFFBQVE7UUFBQ1AsZ0RBQVdBO0tBQUM7SUFDckJRLFlBQVk7UUFDVixDQUFDUixnREFBV0EsQ0FBQ1MsRUFBRSxDQUFDLEVBQUVWLDJDQUFJQSxDQUFDSywyQkFBK0I7SUFDeEQ7QUFDRixHQUFHIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vdHJvdmVwaWxvdC11aS8uL3NyYy9saWIvd2FnbWkudHM/MzRmYSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBnZXREZWZhdWx0Q29uZmlnIH0gZnJvbSAnQHJhaW5ib3ctbWUvcmFpbmJvd2tpdCc7XG5pbXBvcnQgeyBodHRwIH0gZnJvbSAnd2FnbWknO1xuaW1wb3J0IHsgbWV6b1Rlc3RuZXQgfSBmcm9tICcuL2NoYWlucyc7XG5cbmV4cG9ydCBjb25zdCB3YWdtaUNvbmZpZyA9IGdldERlZmF1bHRDb25maWcoe1xuICBhcHBOYW1lOiAnVHJvdmVQaWxvdCcsXG4gIHByb2plY3RJZDogcHJvY2Vzcy5lbnYuTkVYVF9QVUJMSUNfV0NfUFJPSkVDVF9JRCB8fCAnJyxcbiAgY2hhaW5zOiBbbWV6b1Rlc3RuZXRdLFxuICB0cmFuc3BvcnRzOiB7XG4gICAgW21lem9UZXN0bmV0LmlkXTogaHR0cChwcm9jZXNzLmVudi5ORVhUX1BVQkxJQ19SUENfVVJMKSxcbiAgfSxcbn0pOyJdLCJuYW1lcyI6WyJnZXREZWZhdWx0Q29uZmlnIiwiaHR0cCIsIm1lem9UZXN0bmV0Iiwid2FnbWlDb25maWciLCJhcHBOYW1lIiwicHJvamVjdElkIiwicHJvY2VzcyIsImVudiIsIk5FWFRfUFVCTElDX1dDX1BST0pFQ1RfSUQiLCJjaGFpbnMiLCJ0cmFuc3BvcnRzIiwiaWQiLCJORVhUX1BVQkxJQ19SUENfVVJMIl0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./src/lib/wagmi.ts\n");

/***/ }),

/***/ "./src/pages/_app.tsx":
/*!****************************!*\
  !*** ./src/pages/_app.tsx ***!
  \****************************/
/***/ ((module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.a(module, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {\n__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ App)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _rainbow_me_rainbowkit_styles_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @rainbow-me/rainbowkit/styles.css */ \"./node_modules/@rainbow-me/rainbowkit/dist/index.css\");\n/* harmony import */ var _rainbow_me_rainbowkit_styles_css__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_rainbow_me_rainbowkit_styles_css__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @rainbow-me/rainbowkit */ \"@rainbow-me/rainbowkit\");\n/* harmony import */ var wagmi__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! wagmi */ \"wagmi\");\n/* harmony import */ var _lib_wagmi__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../lib/wagmi */ \"./src/lib/wagmi.ts\");\n/* harmony import */ var _lib_chains__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../lib/chains */ \"./src/lib/chains.ts\");\n/* harmony import */ var _tanstack_react_query__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! @tanstack/react-query */ \"@tanstack/react-query\");\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../styles/globals.css */ \"./src/styles/globals.css\");\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_7___default = /*#__PURE__*/__webpack_require__.n(_styles_globals_css__WEBPACK_IMPORTED_MODULE_7__);\nvar __webpack_async_dependencies__ = __webpack_handle_async_dependencies__([_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_2__, wagmi__WEBPACK_IMPORTED_MODULE_3__, _lib_wagmi__WEBPACK_IMPORTED_MODULE_4__, _lib_chains__WEBPACK_IMPORTED_MODULE_5__, _tanstack_react_query__WEBPACK_IMPORTED_MODULE_6__]);\n([_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_2__, wagmi__WEBPACK_IMPORTED_MODULE_3__, _lib_wagmi__WEBPACK_IMPORTED_MODULE_4__, _lib_chains__WEBPACK_IMPORTED_MODULE_5__, _tanstack_react_query__WEBPACK_IMPORTED_MODULE_6__] = __webpack_async_dependencies__.then ? (await __webpack_async_dependencies__)() : __webpack_async_dependencies__);\n/* __next_internal_client_entry_do_not_use__ default auto */ \n\n\n\n\n\n\n\nconst queryClient = new _tanstack_react_query__WEBPACK_IMPORTED_MODULE_6__.QueryClient();\nconst MezoAvatar = ({ address, size })=>{\n    const short = address ? `${address.slice(2, 4)}`.toUpperCase() : \"MZ\";\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n        style: {\n            width: size,\n            height: size,\n            borderRadius: 999,\n            background: \"linear-gradient(135deg, rgba(245,176,0,1) 0%, rgba(255,214,102,1) 100%)\",\n            display: \"flex\",\n            alignItems: \"center\",\n            justifyContent: \"center\",\n            color: \"#2b2b2b\",\n            fontWeight: 800,\n            fontSize: Math.max(10, Math.floor((size || 24) / 2.4)),\n            letterSpacing: 0.4,\n            border: \"1px solid rgba(0,0,0,0.15)\"\n        },\n        \"aria-label\": \"Mezo avatar\",\n        title: `Account ${address}`,\n        children: short\n    }, void 0, false, {\n        fileName: \"/Users/vital/workspace/hackathon/mezo-trove-pilot/ui/src/pages/_app.tsx\",\n        lineNumber: 20,\n        columnNumber: 5\n    }, undefined);\n};\nfunction App({ Component, pageProps }) {\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(wagmi__WEBPACK_IMPORTED_MODULE_3__.WagmiProvider, {\n        config: _lib_wagmi__WEBPACK_IMPORTED_MODULE_4__.wagmiConfig,\n        children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_tanstack_react_query__WEBPACK_IMPORTED_MODULE_6__.QueryClientProvider, {\n            client: queryClient,\n            children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_2__.RainbowKitProvider, {\n                chains: [\n                    _lib_chains__WEBPACK_IMPORTED_MODULE_5__.mezoTestnet\n                ],\n                theme: (0,_rainbow_me_rainbowkit__WEBPACK_IMPORTED_MODULE_2__.lightTheme)({\n                    accentColor: \"#2563eb\",\n                    borderRadius: \"large\"\n                }),\n                avatar: MezoAvatar,\n                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(Component, {\n                    ...pageProps\n                }, void 0, false, {\n                    fileName: \"/Users/vital/workspace/hackathon/mezo-trove-pilot/ui/src/pages/_app.tsx\",\n                    lineNumber: 53,\n                    columnNumber: 11\n                }, this)\n            }, void 0, false, {\n                fileName: \"/Users/vital/workspace/hackathon/mezo-trove-pilot/ui/src/pages/_app.tsx\",\n                lineNumber: 48,\n                columnNumber: 9\n            }, this)\n        }, void 0, false, {\n            fileName: \"/Users/vital/workspace/hackathon/mezo-trove-pilot/ui/src/pages/_app.tsx\",\n            lineNumber: 47,\n            columnNumber: 7\n        }, this)\n    }, void 0, false, {\n        fileName: \"/Users/vital/workspace/hackathon/mezo-trove-pilot/ui/src/pages/_app.tsx\",\n        lineNumber: 46,\n        columnNumber: 5\n    }, this);\n}\n\n__webpack_async_result__();\n} catch(e) { __webpack_async_result__(e); } });//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9zcmMvcGFnZXMvX2FwcC50c3giLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUMyQztBQUtYO0FBRU07QUFDSztBQUNDO0FBQzZCO0FBQzFDO0FBRS9CLE1BQU1PLGNBQWMsSUFBSUYsOERBQVdBO0FBRW5DLE1BQU1HLGFBQThCLENBQUMsRUFBRUMsT0FBTyxFQUFFQyxJQUFJLEVBQUU7SUFDcEQsTUFBTUMsUUFBUUYsVUFBVSxDQUFDLEVBQUVBLFFBQVFHLEtBQUssQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDQyxXQUFXLEtBQUs7SUFDakUscUJBQ0UsOERBQUNDO1FBQ0NDLE9BQU87WUFDTEMsT0FBT047WUFDUE8sUUFBUVA7WUFDUlEsY0FBYztZQUNkQyxZQUNFO1lBQ0ZDLFNBQVM7WUFDVEMsWUFBWTtZQUNaQyxnQkFBZ0I7WUFDaEJDLE9BQU87WUFDUEMsWUFBWTtZQUNaQyxVQUFVQyxLQUFLQyxHQUFHLENBQUMsSUFBSUQsS0FBS0UsS0FBSyxDQUFDLENBQUNsQixRQUFRLEVBQUMsSUFBSztZQUNqRG1CLGVBQWU7WUFDZkMsUUFBUTtRQUNWO1FBQ0FDLGNBQVc7UUFDWEMsT0FBTyxDQUFDLFFBQVEsRUFBRXZCLFFBQVEsQ0FBQztrQkFFMUJFOzs7Ozs7QUFHUDtBQUVlLFNBQVNzQixJQUFJLEVBQUVDLFNBQVMsRUFBRUMsU0FBUyxFQUFZO0lBQzVELHFCQUNFLDhEQUFDakMsZ0RBQWFBO1FBQUNrQyxRQUFRakMsbURBQVdBO2tCQUNoQyw0RUFBQ0csc0VBQW1CQTtZQUFDK0IsUUFBUTlCO3NCQUMzQiw0RUFBQ1Asc0VBQWtCQTtnQkFDakJzQyxRQUFRO29CQUFDbEMsb0RBQVdBO2lCQUFDO2dCQUNyQm1DLE9BQU90QyxrRUFBVUEsQ0FBQztvQkFBRXVDLGFBQWE7b0JBQVd0QixjQUFjO2dCQUFRO2dCQUNsRXVCLFFBQVFqQzswQkFFUiw0RUFBQzBCO29CQUFXLEdBQUdDLFNBQVM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUtsQyIsInNvdXJjZXMiOlsid2VicGFjazovL3Ryb3ZlcGlsb3QtdWkvLi9zcmMvcGFnZXMvX2FwcC50c3g/ZjlkNiJdLCJzb3VyY2VzQ29udGVudCI6WyIndXNlIGNsaWVudCc7XG5pbXBvcnQgJ0ByYWluYm93LW1lL3JhaW5ib3draXQvc3R5bGVzLmNzcyc7XG5pbXBvcnQge1xuICBSYWluYm93S2l0UHJvdmlkZXIsXG4gIGxpZ2h0VGhlbWUsXG4gIHR5cGUgQXZhdGFyQ29tcG9uZW50LFxufSBmcm9tICdAcmFpbmJvdy1tZS9yYWluYm93a2l0JztcbmltcG9ydCB0eXBlIHsgQXBwUHJvcHMgfSBmcm9tICduZXh0L2FwcCc7XG5pbXBvcnQgeyBXYWdtaVByb3ZpZGVyIH0gZnJvbSAnd2FnbWknO1xuaW1wb3J0IHsgd2FnbWlDb25maWcgfSBmcm9tICcuLi9saWIvd2FnbWknO1xuaW1wb3J0IHsgbWV6b1Rlc3RuZXQgfSBmcm9tICcuLi9saWIvY2hhaW5zJztcbmltcG9ydCB7IFF1ZXJ5Q2xpZW50LCBRdWVyeUNsaWVudFByb3ZpZGVyIH0gZnJvbSAnQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5JztcbmltcG9ydCAnLi4vc3R5bGVzL2dsb2JhbHMuY3NzJztcblxuY29uc3QgcXVlcnlDbGllbnQgPSBuZXcgUXVlcnlDbGllbnQoKTtcblxuY29uc3QgTWV6b0F2YXRhcjogQXZhdGFyQ29tcG9uZW50ID0gKHsgYWRkcmVzcywgc2l6ZSB9KSA9PiB7XG4gIGNvbnN0IHNob3J0ID0gYWRkcmVzcyA/IGAke2FkZHJlc3Muc2xpY2UoMiwgNCl9YC50b1VwcGVyQ2FzZSgpIDogJ01aJztcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICB3aWR0aDogc2l6ZSxcbiAgICAgICAgaGVpZ2h0OiBzaXplLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDk5OSxcbiAgICAgICAgYmFja2dyb3VuZDpcbiAgICAgICAgICAnbGluZWFyLWdyYWRpZW50KDEzNWRlZywgcmdiYSgyNDUsMTc2LDAsMSkgMCUsIHJnYmEoMjU1LDIxNCwxMDIsMSkgMTAwJSknLFxuICAgICAgICBkaXNwbGF5OiAnZmxleCcsXG4gICAgICAgIGFsaWduSXRlbXM6ICdjZW50ZXInLFxuICAgICAgICBqdXN0aWZ5Q29udGVudDogJ2NlbnRlcicsXG4gICAgICAgIGNvbG9yOiAnIzJiMmIyYicsXG4gICAgICAgIGZvbnRXZWlnaHQ6IDgwMCxcbiAgICAgICAgZm9udFNpemU6IE1hdGgubWF4KDEwLCBNYXRoLmZsb29yKChzaXplIHx8IDI0KSAvIDIuNCkpLFxuICAgICAgICBsZXR0ZXJTcGFjaW5nOiAwLjQsXG4gICAgICAgIGJvcmRlcjogJzFweCBzb2xpZCByZ2JhKDAsMCwwLDAuMTUpJyxcbiAgICAgIH19XG4gICAgICBhcmlhLWxhYmVsPVwiTWV6byBhdmF0YXJcIlxuICAgICAgdGl0bGU9e2BBY2NvdW50ICR7YWRkcmVzc31gfVxuICAgID5cbiAgICAgIHtzaG9ydH1cbiAgICA8L2Rpdj5cbiAgKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IENvbXBvbmVudCwgcGFnZVByb3BzIH06IEFwcFByb3BzKSB7XG4gIHJldHVybiAoXG4gICAgPFdhZ21pUHJvdmlkZXIgY29uZmlnPXt3YWdtaUNvbmZpZ30+XG4gICAgICA8UXVlcnlDbGllbnRQcm92aWRlciBjbGllbnQ9e3F1ZXJ5Q2xpZW50fT5cbiAgICAgICAgPFJhaW5ib3dLaXRQcm92aWRlclxuICAgICAgICAgIGNoYWlucz17W21lem9UZXN0bmV0XX1cbiAgICAgICAgICB0aGVtZT17bGlnaHRUaGVtZSh7IGFjY2VudENvbG9yOiAnIzI1NjNlYicsIGJvcmRlclJhZGl1czogJ2xhcmdlJyB9KX1cbiAgICAgICAgICBhdmF0YXI9e01lem9BdmF0YXJ9XG4gICAgICAgID5cbiAgICAgICAgICA8Q29tcG9uZW50IHsuLi5wYWdlUHJvcHN9IC8+XG4gICAgICAgIDwvUmFpbmJvd0tpdFByb3ZpZGVyPlxuICAgICAgPC9RdWVyeUNsaWVudFByb3ZpZGVyPlxuICAgIDwvV2FnbWlQcm92aWRlcj5cbiAgKTtcbn1cbiJdLCJuYW1lcyI6WyJSYWluYm93S2l0UHJvdmlkZXIiLCJsaWdodFRoZW1lIiwiV2FnbWlQcm92aWRlciIsIndhZ21pQ29uZmlnIiwibWV6b1Rlc3RuZXQiLCJRdWVyeUNsaWVudCIsIlF1ZXJ5Q2xpZW50UHJvdmlkZXIiLCJxdWVyeUNsaWVudCIsIk1lem9BdmF0YXIiLCJhZGRyZXNzIiwic2l6ZSIsInNob3J0Iiwic2xpY2UiLCJ0b1VwcGVyQ2FzZSIsImRpdiIsInN0eWxlIiwid2lkdGgiLCJoZWlnaHQiLCJib3JkZXJSYWRpdXMiLCJiYWNrZ3JvdW5kIiwiZGlzcGxheSIsImFsaWduSXRlbXMiLCJqdXN0aWZ5Q29udGVudCIsImNvbG9yIiwiZm9udFdlaWdodCIsImZvbnRTaXplIiwiTWF0aCIsIm1heCIsImZsb29yIiwibGV0dGVyU3BhY2luZyIsImJvcmRlciIsImFyaWEtbGFiZWwiLCJ0aXRsZSIsIkFwcCIsIkNvbXBvbmVudCIsInBhZ2VQcm9wcyIsImNvbmZpZyIsImNsaWVudCIsImNoYWlucyIsInRoZW1lIiwiYWNjZW50Q29sb3IiLCJhdmF0YXIiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///./src/pages/_app.tsx\n");

/***/ }),

/***/ "./src/styles/globals.css":
/*!********************************!*\
  !*** ./src/styles/globals.css ***!
  \********************************/
/***/ (() => {



/***/ }),

/***/ "react/jsx-dev-runtime":
/*!****************************************!*\
  !*** external "react/jsx-dev-runtime" ***!
  \****************************************/
/***/ ((module) => {

"use strict";
module.exports = require("react/jsx-dev-runtime");

/***/ }),

/***/ "@rainbow-me/rainbowkit":
/*!*****************************************!*\
  !*** external "@rainbow-me/rainbowkit" ***!
  \*****************************************/
/***/ ((module) => {

"use strict";
module.exports = import("@rainbow-me/rainbowkit");;

/***/ }),

/***/ "@tanstack/react-query":
/*!****************************************!*\
  !*** external "@tanstack/react-query" ***!
  \****************************************/
/***/ ((module) => {

"use strict";
module.exports = import("@tanstack/react-query");;

/***/ }),

/***/ "viem":
/*!***********************!*\
  !*** external "viem" ***!
  \***********************/
/***/ ((module) => {

"use strict";
module.exports = import("viem");;

/***/ }),

/***/ "wagmi":
/*!************************!*\
  !*** external "wagmi" ***!
  \************************/
/***/ ((module) => {

"use strict";
module.exports = import("wagmi");;

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/@rainbow-me"], () => (__webpack_exec__("./src/pages/_app.tsx")));
module.exports = __webpack_exports__;

})();