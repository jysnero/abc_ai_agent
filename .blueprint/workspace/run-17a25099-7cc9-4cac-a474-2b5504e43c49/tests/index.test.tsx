```tsx
/**
 * Tests for the application entry point (src/index.tsx).
 *
 * The entry module runs side effects on import. Each test therefore:
 * 1. resets the module registry,
 * 2. prepares the DOM and document.readyState,
 * 3. imports the module fresh.
 */
import React, { StrictMode } from 'react';

const renderMock = jest.fn();
const createRootMock = jest.fn((_container: Element) => ({
  render: renderMock,
  unmount: jest.fn(),
}));

jest.mock('react-dom/client', () => ({
  __esModule: true,
  createRoot: (container: Element) => createRootMock(container),
}));

// Replace Game with a stub so these tests stay unit-level.
jest.mock('../src/pages/Game', () => ({
  __esModule: true,
  default: function GameStub() {
    return null;
  },
}));

type ReadyState = DocumentReadyState;

function setReadyState(state: ReadyState) {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => state,
  });
}

function loadEntry() {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/index');
  });
}

function getGameStub() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/pages/Game').default;
}

describe('src/index.tsx entry point', () => {
  beforeEach(() => {
    jest.resetModules();
    renderMock.mockClear();
    createRootMock.mockClear();
    document.body.innerHTML = '';
    setReadyState('complete');
  });

  afterAll(() => {
    // Remove the instance-level override and restore jsdom's getter.
    delete (document as unknown as { readyState?: unknown }).readyState;
  });

  describe('main functionality', () => {
    it('mounts immediately when the document is already loaded', () => {
      const root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);

      loadEntry();

      expect(createRootMock).toHaveBeenCalledTimes(1);
      expect(createRootMock).toHaveBeenCalledWith(root);
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('mounts immediately when readyState is "interactive"', () => {
      setReadyState('interactive');
      loadEntry();
      expect(createRootMock).toHaveBeenCalledTimes(1);
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('renders <Game /> wrapped in <StrictMode>', () => {
      loadEntry();

      const element = renderMock.mock.calls[0][0] as React.ReactElement<{
        children: React.ReactElement;
      }>;
      expect(element.type).toBe(StrictMode);

      const child = element.props.children;
      expect(React.isValidElement(child)).toBe(true);
      expect(child.type).toBe(getGameStub());
    });

    it('reuses an existing #root element instead of creating a new one', () => {
      const root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);

      loadEntry();

      expect(document.querySelectorAll('#root')).toHaveLength(1);
      expect(createRootMock.mock.calls[0][0]).toBe(root);
    });
  });

  describe('container resolution edge cases', () => {
    it('creates a <div id="root"> and appends it to <body> when absent', () => {
      expect(document.getElementById('root')).toBeNull();

      loadEntry();

      const created = document.getElementById('root');
      expect(created).not.toBeNull();
      expect(created!.tagName).toBe('DIV');
      expect(created!.parentElement).toBe(document.body);
      expect(document.body.lastElementChild).toBe(created);
      expect(createRootMock).toHaveBeenCalledWith(created);
    });

    it('appends the created container after existing body content', () => {
      const existing = document.createElement('main');
      document.body.appendChild(existing);

      loadEntry();

      const created = document.getElementById('root')!;
      expect(existing.nextElementSibling).toBe(created);
    });

    it('uses an existing #root even if it is not a <div>', () => {
      const section = document.createElement('section');
      section.id = 'root';
      document.body.appendChild(section);

      loadEntry();

      expect(createRootMock).toHaveBeenCalledWith(section);
      expect(document.querySelectorAll('#root')).toHaveLength(1);
    });

    it('uses a nested #root that is not a direct child of body', () => {
      const wrapper = document.createElement('div');
      const nested = document.createElement('div');
      nested.id = 'root';
      wrapper.appendChild(nested);
      document.body.appendChild(wrapper);

      loadEntry();

      expect(createRootMock).toHaveBeenCalledWith(nested);
      expect(document.querySelectorAll('#root')).toHaveLength(1);
    });

    it('does not match elements whose id merely contains "root"', () => {
      const decoy = document.createElement('div');
      decoy.id = 'root-legacy';
      document.body.appendChild(decoy);

      loadEntry();

      const actual = document.getElementById('root');
      expect(actual).not.toBeNull();
      expect(actual).not.toBe(decoy);
      expect(createRootMock).toHaveBeenCalledWith(actual);
    });
  });

  describe('deferred mounting while the document is loading', () => {
    beforeEach(() => setReadyState('loading'));

    it('does not mount before DOMContentLoaded fires', () => {
      loadEntry();
      expect(createRootMock).not.toHaveBeenCalled();
      expect(renderMock).not.toHaveBeenCalled();
      expect(document.getElementById('root')).toBeNull();
    });

    it('mounts once DOMContentLoaded fires', () => {
      loadEntry();
      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(createRootMock).toHaveBeenCalledTimes(1);
      expect(renderMock).toHaveBeenCalledTimes(1);
      expect(document.getElementById('root')).not.toBeNull();
    });

    it('registers the listener with { once: true }', () => {
      const spy = jest.spyOn(document, 'addEventListener');
      loadEntry();

      const call = spy.mock.calls.find(([type]) => type === 'DOMContentLoaded');
      expect(call).toBeDefined();
      expect(call![2]).toEqual(expect.objectContaining({ once: true }));
      spy.mockRestore();
    });

    it('mounts only once even if DOMContentLoaded is dispatched repeatedly', () => {
      loadEntry();
      document.dispatchEvent(new Event('DOMContentLoaded'));
      document.dispatchEvent(new Event('DOMContentLoaded'));
      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(createRootMock).toHaveBeenCalledTimes(1);
      expect(renderMock).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll('#root')).toHaveLength(1);
    });

    it('picks up a #root element that is added before DOMContentLoaded', () => {
      loadEntry();

      const lateRoot = document.createElement('div');
      lateRoot.id = 'root';
      document.body.appendChild(lateRoot);

      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(createRootMock).toHaveBeenCalledWith(lateRoot);
      expect(document.querySelectorAll('#root')).toHaveLength(1);
    });

    it('ignores unrelated events', () => {
      loadEntry();
      document.dispatchEvent(new Event('load'));
      document.dispatchEvent(new Event('readystatechange'));
      expect(createRootMock).not.toHaveBeenCalled();
    });
  });

  describe('error cases', () => {
    it('propagates errors thrown by createRoot (fails loudly, not silently)', () => {
      createRootMock.mockImplementationOnce(() => {
        throw new Error('createRoot failed');
      });
      expect(() => loadEntry()).toThrow('createRoot failed');
    });

    it('propagates errors thrown by render', () => {
      renderMock.mockImplementationOnce(() => {
        throw new Error('render failed');
      });
      expect(() => loadEntry()).toThrow('render failed');
    });

    it('does not add a DOMContentLoaded listener when already loaded', () => {
      const spy = jest.spyOn(document, 'addEventListener');
      loadEntry();
      expect(spy.mock.calls.some(([type]) => type === 'DOMContentLoaded')).toBe(false);
      spy.mockRestore();
    });
  });
});
```