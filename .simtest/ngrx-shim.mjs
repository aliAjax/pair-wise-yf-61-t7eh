// createReducer/on/createAction/props 的最小纯函数实现（与 @ngrx/store 语义一致），供 Node 端规则仿真使用
export function on(...args) {
  const reducer = args[args.length - 1];
  const types = args.slice(0, -1).map((a) => a.type);
  return { types, reducer };
}
export function createReducer(initialState, ...handlers) {
  const map = new Map();
  for (const handler of handlers) for (const type of handler.types) map.set(type, handler.reducer);
  return (state, action) => {
    const handler = map.get(action.type);
    return handler ? handler(state, action) : state === undefined ? initialState : state;
  };
}
export function props() {
  return null;
}
export function createAction(type) {
  const action = (payload) => ({ type, ...payload });
  action.type = type;
  return action;
}

