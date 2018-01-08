import { KEYBINDING_UPDATE } from 'core/actions/types';
import { defaultCommands } from './defaults';

export default function keyboardConfigReducer(
  state = defaultCommands,
  action,
) {
  if (action.type !== KEYBINDING_UPDATE || !(command in state)) {
    return state;
  }
  const { command, keyBinding } = action.payload;
  const newCommand = Object.assign({}, state[command], { command: keyBinding });
  return Object.assign(
    {},
    state,
    { [command]: newCommand },
  );
}
