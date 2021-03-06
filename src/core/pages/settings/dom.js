import keyboard from 'core/keyboard';
import { DEL_CIRCLE_SVG_PATH } from 'core/pages/popup/constants';
import reducerMap from './inputs-to-reducer';
import {
  updateKeybinding,
  resetKeyboardToDefaults,
  updateFuzzyThresholdRange,
  updateCheckbox,
  updateFuzzyCheckbox,
  updateFuzzySearchKeys,
  updateNumber,
  resetSetting,
  updateColor,
  updateSecondaryKeybinding,
  removeSecondaryKeybinding,
} from './actions';
import * as Flash from './flash';
import {
  SHORTCUT_TABLE_BODY,
  SHORTCUT_TABLE_NAME,
  SHORTCUT_TABLE_SHORTCUT,
  SHORTCUT_TABLE_DESCRIPTION,
  SHORTCUT_TABLE_INPUT,
  ERROR_MSG_NOT_VALID_SINGLE_KEY,
  ERROR_MSG_NOT_VALID_FINAL_COMBO_KEY,
  ERROR_MSG_FINAL_KEY_IS_MODIFIER,
  SHORTCUT_RESET_BUTTON_ID,
  HINT_MSG_SHOULD_USE_MODIFIERS,
  HINT_MSG_SINGLE_KEYS,
  HINT_MSG_TRY_PUNCTUATION,
  HINT_MSG_NEED_FINAL_KEY,
} from './constants';


const d = document;

export function initSettings(store) {
  const settings = store.getState();
  const fillStateSettings = getStateSettings(settings);
  const attachEventListeners = configureSettingListeners(store.dispatch);
  const inputs = findInputs();
  Object.values(inputs).forEach(fillStateSettings);
  Object.values(inputs).forEach(attachEventListeners);

  // Reset each setting
  const fieldsetButtons = [...document.querySelectorAll('fieldset')]
    .map(x => [x, x.querySelector('button')]);
  fieldsetButtons.forEach(([fieldsetNode, btn]) => {
    btn.addEventListener('click', () => {
      fieldsetNode.querySelectorAll('input').forEach(({ name }) => {
        store.dispatch(resetSetting(name));
      });
      location.reload(true);
    });
  });
}

// Fills in the keyboard area of the settings page with state from current setting
export function initKeybindingTable(store) {
  const stTableBody = d.getElementById(SHORTCUT_TABLE_BODY);
  // Connect to bg-store
  const { subscribe, dispatch, getState } = store;
  const kbString = x =>
    keyboard.toString(x, store.os === browser.runtime.PlatformOs.MAC);
  const kbHandlers = keybindInputHandlers(store, kbString);
  const { keyboard: keyboardState } = getState();

  // Handle dom updates on state-change
  subscribe(keyBindingSubscription);

  // Prepare the table
  clearChildNodes(stTableBody);
  stateToTableRows(keyboardState, kbHandlers, kbString).forEach((trRow) => {
    stTableBody.appendChild(trRow);
  });

  // Prepare the reset button
  const resetDefaultsButton = d.getElementById(SHORTCUT_RESET_BUTTON_ID);
  resetDefaultsButton.addEventListener('click', () => {
    dispatch(resetKeyboardToDefaults());
  });

  let prevState = keyboardState;
  function keyBindingSubscription() {
    const compareCommands = (x, y) => keyboard.isEqual(x.command, y.command)
      && keyboard.isEqual(x.secondaryCommand, y.secondaryCommand);
    const selectKbd = state => state().keyboard;
    const newState = selectKbd(store.getState);
    const not = predicate => (...args) => !predicate(...args);
    diffStateKeys(prevState, newState, compareCommands)
      .forEach((key) => {
        const {
          command: oldCommand,
          secondaryCommand: oldSecondaryCommand,
        } = prevState[key];
        const {
          name,
          command: newCommand,
          secondaryCommand: newSecondaryCommand,
        } = newState[key];
        const msg = (oldC, newC) => `
          ${name} shortcut updated: <${kbString(oldC)}> changed to <${kbString(newC)}>
        `;
        const changed = [
          [oldCommand, newCommand],
          [oldSecondaryCommand, newSecondaryCommand],
        ].filter(not(keyboard.isEqual));
        // Flash each shortcut changed
        const appendOkFlash = ([prev, next]) => Flash.appendOk(msg(prev, next));
        changed.forEach(appendOkFlash);
        updateTableRow(key, kbString(newCommand), kbString(newSecondaryCommand));
      });
    prevState = newState;
  }
}

// Object containing input ids and their Handlerscorresponding nodes
function findInputs() {
  return [...document.querySelectorAll('input')]
    // Filter out all inputs who arent in charge of a setting
    .filter(({ id }) => id in reducerMap)
    .reduce((acc, node) => Object.assign({}, acc, { [node.id]: node }), {});
}
// Given the setting object and the location we want to search, return the
// current setting value
// e.g. 'fuzzySearch.enableFuzzySearch' -> settings.fuzzySearch.enableFuzzySearch
function findSetting(settings, location) {
  const locationSplit = location.split('.');
  const hasDepth = locationSplit.length > 1;
  if (hasDepth) {
    const walkObject = (acc, key) => acc[key];
    return locationSplit.reduce(walkObject, settings);
  }
  return settings[location];
}

function getStateSettings(settings) {
  return function fillStateSettings(node) {
    const { id, type } = node;
    const stateSettingValue = findSetting(settings, reducerMap[id]);
    switch (type) {
      case 'checkbox':
        if (typeof stateSettingValue === 'boolean') {
          node.checked = stateSettingValue;
        } else if (Array.isArray(stateSettingValue)) {
          // If here this is the showUrls options, the state only stores an
          // an array of keys we're allowed to search in. The only thing
          // we can change is whether the 'url' value is present in the array
          node.checked = stateSettingValue.includes('url');
        }
        break;
      case 'color':
      case 'number':
        node.value = stateSettingValue;
        break;
      case 'range':
        node.value = stateSettingValue * 10;
        break;
      default: break;
    }
    node.dispatchEvent(new Event('change'));
  };
}


// Decides which action to dispatch based on the input that changed
function configureSettingListeners(dispatch) {
  return function attachEventListeners(node) {
    node.addEventListener('change', (event) => {
      // Figure out which action to dispatch based on the node's props
      const {
        id,
        type,
        value,
        checked,
        validity,
      } = event.currentTarget;
      const settingsLocation = reducerMap[id].split('.');
      const settingKey = settingsLocation[settingsLocation.length - 1];
      switch (type) {
        case 'range': {
          dispatch(updateFuzzyThresholdRange(parseInt(value, 10)));
          break;
        }
        case 'checkbox': {
          if (settingKey === 'showBookmarks' || settingKey === 'showHistory') {
            const permission = settingKey.slice('show'.length).toLowerCase();
            browser.permissions.request({ permissions: [permission] })
              .then((granted) => {
                // If user declines reset the checkbox to unchecked
                if (granted) {
                  dispatch(updateCheckbox(settingKey, checked));
                } else {
                  document.getElementById(settingKey).checked = false;
                }
              });
          } else if (settingsLocation[0] === 'fuzzy' && settingKey !== 'keys') {
            dispatch(updateFuzzyCheckbox(settingKey));
          } else if (settingKey === 'keys') {
            dispatch(updateFuzzySearchKeys(checked));
          } else {
            dispatch(updateCheckbox(settingKey, checked));
          }
          break;
        }
        case 'number': {
          const {
            rangeUnderflow,
            rangeOverflow,
          } = validity;
          if (!rangeUnderflow && !rangeOverflow) {
            dispatch(updateNumber(settingKey, value));
          }
          break;
        }
        case 'color': dispatch(updateColor(settingKey, value));
        default: break;
      }
    });
  };
}

export function clearChildNodes(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
  return node;
}

// Returns an array of keys showing which keys differed
function diffStateKeys(obj1, obj2, compare) {
  return Object.keys(obj2).filter(key => !compare(obj1[key], obj2[key]));
}

// Given the entire keyboard-shortcut state, return an array of <tr> nodes
function stateToTableRows(keyboardState, handlers, kbString) {
  const toRow = key => commandToTableRow(
    keyboardState[key],
    handlers,
    kbString,
  );
  return Object.keys(keyboardState).map(toRow);
}

// Given a row id and the table node, update that row's input node to
// display the given value
function updateTableRow(id, primaryShortcut, secondaryShortcut) {
  // Update both values at a time, even if one doesn't change
  // This selector works as long as there are exactly 2 inputs
  const inputs = d.getElementById(id).querySelectorAll('input');
  inputs.forEach((input) => {
    switch (input.type) {
      case 'text': {
        const value = input.dataset.key === 'command'
          ? primaryShortcut
          : secondaryShortcut;
        input.defaultValue = value;
        input.value = value;
        break;
      }
      case 'image': {
        if (secondaryShortcut === keyboard.toString(null)) {
          input.classList.add('hidden');
        } else {
          input.classList.remove('hidden');
        }
        break;
      }
      default: break;
    }
  });
}

/* Output:
<tr id={KEY}>
  <td>
    {NAME}
  </td>
  <td>
    <input type="text" value={string(command)} data-key="command">
  </td>
  <td>
    <input type="text" value={string(command)} data-key="secondaryCommand">
  </td>
  <td>
    {description}
  </td>
</tr>
*/
// Given an object from the keyboard reducer, output a table row
// for insertion into the settings page
function commandToTableRow(
  { key, name, command, secondaryCommand, description },
  handlers,
  kbString,
) {
  const trNode = d.createElement('tr');
  trNode.setAttribute('id', key);

  const tdNameNode = d.createElement('td');
  tdNameNode.classList.add(SHORTCUT_TABLE_NAME);
  tdNameNode.appendChild(d.createTextNode(name));

  const tdShortcutNode = d.createElement('td');
  const tdSecondaryShortcutNode = d.createElement('td');
  const tds = [tdShortcutNode, tdSecondaryShortcutNode];
  tds.forEach((node) => {
    node.classList.add(SHORTCUT_TABLE_SHORTCUT);
  });

  // Shortcut input handlers
  // The secondaryInputNode should have the special property of being
  // deleteable, if deleted it should show 'No Shortcut Set'.
  // In the future, we might want to make both shortcuts deletable.
  // This would require making the secondary shortcut shift up to the
  // primary shortcuts position.
  const primaryInputNode = [d.createElement('input'), 'command'];
  const secondaryInputNode = [d.createElement('input'), 'secondaryCommand'];
  const inputs = [primaryInputNode, secondaryInputNode];
  inputs.forEach(([node, commandKey]) => {
    const isPrimary = commandKey !== 'secondaryCommand';
    node.setAttribute('type', 'text');
    node.classList.add(SHORTCUT_TABLE_INPUT);
    if (isPrimary) {
      node.value = kbString(command);
      node.defaultValue = kbString(command);
    } else {
      // Secondary case
      node.value = kbString(secondaryCommand);
      node.defaultValue = kbString(secondaryCommand);
    }
    node.dataset.key = commandKey;
    node.addEventListener('blur', handlers.onInputBlur);
    node.addEventListener('focus', handlers.onInputFocus);
    if (isPrimary) {
      tdShortcutNode.appendChild(node);
    } else {
      tdSecondaryShortcutNode.append(node);
      // Reset secondary shortcuts
      const secondaryResetButton = d.createElement('input');
      secondaryResetButton.classList.add('delete-circle');
      if (kbString(secondaryCommand) === keyboard.toString(null)) {
        secondaryResetButton.classList.add('hidden');
      }
      secondaryResetButton.type = 'image';
      secondaryResetButton.role = 'button';
      secondaryResetButton.src = DEL_CIRCLE_SVG_PATH;
      secondaryResetButton.addEventListener('click', handlers.onSecondaryReset);
      tdSecondaryShortcutNode.append(secondaryResetButton);
    }
  });

  const tdShortcutDescriptionNode = d.createElement('td');
  tdShortcutDescriptionNode.classList.add(SHORTCUT_TABLE_DESCRIPTION);
  tdShortcutDescriptionNode.appendChild(d.createTextNode(description));

  const trChildren = [
    tdNameNode,
    tdShortcutNode,
    tdSecondaryShortcutNode,
    tdShortcutDescriptionNode,
  ];
  for (let i = 0; i < trChildren.length; i += 1) {
    const child = trChildren[i];
    trNode.appendChild(child);
  }
  return trNode;
}

function keybindInputHandlers(store, kbString) {
  const onInputFocus = (event) => {
    event.currentTarget.value = 'Enter your shortcut...';
    event.currentTarget.addEventListener('keydown', onInputKeydown);
    return event;
  };

  // On blur we'll probably flash the last error message if it wasn't a valid key
  const onInputBlur = (event) => {
    event.currentTarget.removeEventListener('keydown', onInputKeydown);
    event.currentTarget.value = event.currentTarget.defaultValue;
  };

  const onSecondaryReset = (event) => {
    const { id: key } = event.currentTarget.parentElement.parentElement;
    if (key in store.getState().keyboard) {
      store.dispatch(removeSecondaryKeybinding(key));
    }
  };

  return {
    onInputFocus,
    onInputBlur,
    onSecondaryReset,
  };

  function isDuplicateCommand(state, command) {
    const key = Object.values(state)
      .find(k => keyboard.isEqual(k.command, command)
        || keyboard.isEqual(k.secondaryCommand, command),
      );

    if (key) {
      return { key, isDuplicate: true };
    }

    return { isDuplicate: false };
  }

  // Handles incoming new commands
  // Attached to dom by onInputFocus
  function onInputKeydown(event) {
    event.preventDefault();
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    const { id: parentId } = event.currentTarget.parentElement.parentElement;
    const command = keyboard.command(event);
    const isValid = keyboard.isValid(command);
    const { name } = store.getState().keyboard[parentId];
    if (isValid) {
      const { isDuplicate, key: duplicateKey } =
        isDuplicateCommand(store.getState().keyboard, command);
      if (isDuplicate && duplicateKey === parentId) {
        Flash.message(`<${kbString(command)}> is already ${name}'s shortcut.`, Flash.WARNING);
        event.currentTarget.blur();
      } else if (isDuplicate) {
        Flash.message(`Duplicate key! <${kbString(command)}> is ${name}'s shortcut.`, Flash.ERROR);
      } else {
        // Stop input reset race
        event.currentTarget.blur();
        Flash.close();
        // Actually update the store with the new binding here
        const updateBinding =
          event.currentTarget.dataset.key === 'secondaryCommand'
            ? updateSecondaryKeybinding
            : updateKeybinding;
        store.dispatch(updateBinding(parentId, command));
      }
    } else {
      // Then it's an error
      let flashType;
      let appendMsg;
      switch (command.error) {
        // Warning
        case ERROR_MSG_FINAL_KEY_IS_MODIFIER:
          flashType = Flash.WARNING;
          appendMsg = [HINT_MSG_NEED_FINAL_KEY];
          break;
        // Error
        case ERROR_MSG_NOT_VALID_FINAL_COMBO_KEY:
        case ERROR_MSG_NOT_VALID_SINGLE_KEY:
        default:
          flashType = Flash.ERROR;
          appendMsg = [
            HINT_MSG_SINGLE_KEYS,
            HINT_MSG_SHOULD_USE_MODIFIERS,
            HINT_MSG_TRY_PUNCTUATION,
          ];
          break;
      }
      Flash.message(
        `${kbString(command)} is ${lowerCaseSentence(command.error)}`,
        flashType,
      );
      Flash.append(appendMsg);
    }
  }
}

function lowerCaseSentence(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
