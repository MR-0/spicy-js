import { Element } from './Element.js';

// --------------------------------------

const Component = function (attrs, content, entry) {
  const { path } = attrs;
  const holder = new DocumentFragment();

  this.file = path?.split('/').pop() || 'undefined';
  this.terms = [attrs];
  this.props = { attrs };

  this.entry = entry || new DocumentFragment();
  this.nodes = [];
  this.content = [];
  this.controlled = [];
  this.printed = false;
  this.listener = () => null;

  this.load = loadContent(path, content ?? '').then((str) => {
    content = str;
    return this;
  });

  const readed = this.load
    .then(() => this.read(content))
    .then(({ nodes, content, controlled }) => {
      this.nodes = nodes;
      this.content = content;
      this.controlled = controlled;
      this.nodes.map(({ node }) => holder.appendChild(node));
      return this.render();
    })
    .then(() => (this.printed = true));

  this.mount = readed.then(() => {
    this.entry.appendChild(holder);
    return this;
  });

  this.props.onLoad = (fun) => this.load.then(() => fun());
  this.props.onMount = (fun) => this.mount.then(() => fun());
  this.props.onChange = (fun) => (this.listener = (data) => fun(this, data));
  this.props.addTerms = (...args) => {
    args.map((arg) => this.terms.push(arg));
  };
  this.props.addState = (obj) => {
    const [state, listener] = addState(obj);
    const mute = listener(this.render.bind(this));
    return state;
  };
};

Component.prototype.read = function (str) {
  const clean = cleanContent(str);
  const { props, file } = this;
  const [cont, customs] = replaceCustomElements(clean);
  const tree = makeTree(cont);
  const styles = pickLeafts(tree, 'style');
  const scripts = pickLeafts(tree, 'script');
  const nodes = pickContent(tree) || [];
  const content = flat(nodes, (item) => item.content);
  const read = Promise.all([
    ...readStyles(file, styles),
    ...readScripts(file, scripts, props),
    ...readCustoms(tree, content, customs),
  ]);
  return read.then(() => {
    const controlled = pickControlled(content);
    return { nodes, content, controlled };
  });
};

Component.prototype.update = function (comp) {
  // console.log('-->', comp.file, this.nodes, comp.nodes);

  const drill = (prev, next, lvl = 0) => {
    const max = Math.max(prev.length || 0, next.length || 0);
    const parent = prev[0]?.node.parentNode;
    for (let i = 0; i < max; i++) {
      const p = prev[i];
      const n = next[i];
      // console.log('lvl:', lvl, '-', i, '-', p, n);
      if (p && !n) parent?.removeChild(p.node);
      if (!p && n) parent?.appendChild(n.node);
      if (p && n) {
        const notSame = n.node.nodeName !== p.node.nodeName;
        const nIsArray = Array.isArray(n.content);
        const pIsArray = Array.isArray(p.content);
        if (notSame || nIsArray !== pIsArray) {
          p.node.replaceWith(n.node);
        } else {
          if (!nIsArray && !pIsArray) n.content.result = p.content.result;
          n.node = p.node;
        }
        if (nIsArray && pIsArray) drill(p.content, n.content, lvl + 1);
      }
    }
  };

  drill(this.nodes, comp.nodes);

  this.terms = comp.terms;
  this.props = comp.props;
  this.nodes = comp.nodes;
  this.content = comp.content;
  this.controlled = pickControlled(this.content);
  return this.render();
};

Component.prototype.render = function () {
  const data = this.terms.reduce((out, obj) => ({ ...out, ...obj }));
  const promises = this.controlled.map((item) => {
    const { linked, node, custom } = item;
    const changes = linked
      .map((item) => {
        const { value: val } = item;
        const value = valueEval(val, data);
        return renderItem(node, item, value, data);
      })
      .filter(Boolean);
    const hasChanges = changes.length || !this.printed;

    return hasChanges && custom && renderCustom(item);
  });

  return Promise.all(promises)
    .then(() => this.printed && this.listener(data))
    .then(() => reqFramePromise());
};

Component.prototype.add = async function (elem) {
  const { nodes, content, controlled } = await this.read(elem);
  this.nodes = [...this.nodes, ...nodes];
  this.content = [...this.content, ...content];
  this.controlled = [...this.controlled, ...controlled];
  nodes.map(({ node }) => this.entry.appendChild(node));
};

// --------------------------------------

const loadContent = async (path, content) => {
  const response = path ? await fetch(path) : null;
  const result = response?.status === 200 ? await response.text() : null;
  return [content, result].filter(Boolean).join('\n');
};

const cleanContent = (str) => {
  if (typeof str === 'string') {
    return str.replace(/>[ \n\t\t]*/g, '>').trim();
  }
  return str;
};

const replaceCustomElements = (str) => {
  const { elements } = Element.prototype;
  const customs = [];
  elements.map((element) => {
    const { name } = element;
    const regexs = [
      new RegExp(`<${name}(.*?)>(.*)</${name}>`),
      new RegExp(`<${name}(.*?)/?>`),
    ];
    regexs.map((regx, i) => {
      while (regx.test(str)) {
        str = str.replace(regx, (_, strAttrs, cont) => {
          const content = i ? null : cont;
          const custom = element.add(strAttrs, content);
          customs.push(custom);
          return custom.holder;
        });
      }
    });
  });
  return [str, customs];
};

const makeTree = (content) => {
  const holder = document.createElement('div');
  if (typeof content === 'string') holder.innerHTML = content;
  if (content instanceof DocumentFragment) holder.appendChild(content);
  return holder;
};

const pickLeafts = (tree, tag) => {
  const fragment = new DocumentFragment();
  const arr = Array.from(tree.querySelectorAll(tag));
  return arr.map((element) => {
    fragment.appendChild(element);
    return element;
  });
};

const pickContent = (() => {
  const drill = (node) => {
    const childs = node.childNodes;
    if (!childs.length) return { value: node.textContent };
    else
      return Array.from(childs).map((node) => {
        const content = drill(node);
        const attributess = Array.from(node.attributes || []);
        const attrs = attributess.map(({ name, value }) => ({ name, value }));
        const custom = null;
        return { attrs, content, node, custom };
      });
  };
  return (tree) => {
    const arr = drill(tree);
    return Array.isArray(arr) ? arr : null;
  };
})();

const pickControlled = (flatContent) => {
  const linkTest = (d) => /\{[^\}]+\}/.test(d.value);
  return flatContent
    .map((element) => {
      const { attrs, content } = element;
      const linked = [...attrs, content].filter(linkTest);
      return { ...element, linked };
    })
    .filter(({ linked, custom }) => linked.length || custom);
};

const readStyles = (file, styles) => {
  return styles.map((style, i) => {
    const num = (i + '').padStart(3, '0');
    const element = document.createElement('link');
    const cont = style.textContent.replace(
      /@import url\(['"]?(.+)/g,
      (str, grp) => str.replace(grp, window.location.href + grp)
    );
    const content = `${cont}\n/*# sourceURL=style-${num}_${file}.css*/`;
    const url = blobUrl(content, { type: 'text/css' });
    element.rel = 'stylesheet';
    element.type = 'text/css';
    element.href = url.use();
    document.head.appendChild(element);
    return new Promise((resolve, reject) => {
      element.onload = resolve;
      element.onerror = reject;
    });
  });
};

const readScripts = (file, scripts, props) => {
  return scripts.map((script, i) => {
    const num = (i + '').padStart(3, '0');
    const cont = formatScript(script.textContent, props);
    const content = cont + `\n//# sourceURL=script-${num}_${file}.js`;
    const url = blobUrl(content, { type: 'text/javascript' });
    return import(url.use()).then((mod) => {
      url.delete();
      mod.default(props);
      return mod.default;
    });
  });
};

const readCustoms = (treeHolder, treeContent, customs) => {
  return customs.map((custom) => {
    const { id, attrs, content } = custom;
    const entry = findComments(treeHolder, id)[0];
    const current = treeContent.find(({ node }) => node === entry);
    if (current) {
      current.attrs = attrs;
      current.content.value = content;
      current.custom = custom;
    }
    return current;
  });
};

const formatScript = (str, props) => {
  const propsStr = `{ ${Object.keys(props).join(', ')} }`;
  const termsMatchs = str
    .replace(/\/\/[\w\W]*?\n/g, '')
    .replace(/\/\*[\w\W]*?\*\//g, '')
    .matchAll(/(?:const|let|var) ([^=]+)/g);
  const termsStr = Array.from(termsMatchs)
    .map(([_, d]) => d.trim().replace(/^[\{\[]|[\}\]]$/g, ''))
    .join(', ');

  let last = '';

  str = str.replace(/import.+from(.+);?\n?/g, (str, group) => {
    const location = group.replace('./', window.location.href);
    return (last = str.replace(group, location));
  });
  str = str.replace(last, `${last}\nexport default (${propsStr}) => {\n`);
  str += `\n  addTerms({ ${termsStr} });`;
  str += `\n};`;

  return str;
};

const renderItem = (node, item, value, data) => {
  const { name, result } = item;
  const isSame = value === result;
  const isComment = node.nodeType === 8;
  const isFunction = typeof value === 'function';

  if (isSame) return false;

  if (!isComment) {
    if (name) {
      const isListener = /^on/.test(name);
      if (isListener) {
        renderListener(node, name, value, result);
      } else {
        if (isFunction) node.setAttribute(name, value(data));
        else node.setAttribute(name, value);
      }
    } else {
      if (isFunction) node.textContent = value(data);
      else node.textContent = value;
    }
  }

  item.result = value;

  return true;
};

const renderListener = (node, name, value, result) => {
  const isFunction = typeof value === 'function';
  const hasChange = !result || result.toString() !== value.toString();
  const listenerName = name.replace(/^on/, '');
  const listenerFun = isFunction ? value : window[value];
  if (listenerFun && hasChange) {
    node.removeAttribute(name);
    if (/change/i.test(listenerName)) {
      node.addEventListener('input', listenerFun);
    } else {
      node.addEventListener(listenerName, listenerFun);
    }
  }
};

const renderCustom = async (item) => {
  const { attrs, content, custom } = item;
  const component = await custom.render(attrs, content.value);

  if (!!custom.rendered) return custom.rendered.update(component);

  const olds = custom.rendered?.nodes || [item];
  const old = olds.shift().node;
  const parent = old.parentNode;

  olds.map(({ node }) => parent.removeChild(node));
  parent.replaceChild(component.entry, old);

  component.entry = parent;
  custom.rendered = component;

  return component.mount;
};

const addState = (() => {
  const observe = (obj, key, value, fun) => {
    Object.defineProperty(obj, key, {
      enumerable: true,
      get: () => value,
      set: (current) => {
        if (current !== value) deffer(fun);
        value = current;
      },
    });
  };

  return (obj) => {
    let callbacks = [];

    const state = {};
    const listener = (fun) => {
      if (typeof fun === 'function') callbacks.push(fun);
      return () => {
        callbacks = callbacks.filter((callback) => callback !== fun);
      };
    };

    Object.entries(obj).map(([key, value]) => {
      observe(state, key, value, () => {
        callbacks.map((fun) => fun(state));
      });
    });

    return [state, listener];
  };
})();

const valueEval = (str, data) => {
  const regx = /\{([\w\W]*?)\}/g;
  const matches = str.trim().match(regx);
  if (matches.length === 1 && matches[0] === str) {
    const key = str.replace(regx, '$1');
    return doEval(key, data);
  } else
    return str.replace(regx, (str, key, sub) => {
      return doEval(key, data);
    });
};

const doEval = (() => {
  const global = {};

  return (content, props) => {
    const keys = Object.keys(props);
    const values = keys.map((k) => props[k]);
    const args = keys.join(',');
    const name = '__fun' + Date.now();
    const fun = `function(${args}){
      try { return ${content} }
      catch (err) { return undefined }
    };
    //# sourceURL=spicy.js`;
    return doEval(name, fun, values);
  };

  function doEval() {
    eval('global.' + arguments[0] + '=' + arguments[1]);
    const result = global[arguments[0]].apply({}, arguments[2]);
    delete global[arguments[0]];
    return result;
  }
})();

// --------------------------------------

const reqFramePromise = () => {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
};

const blobUrl = (content, options) => {
  const blob = new Blob([content], options);
  return {
    use: () => URL.createObjectURL(blob),
    delete: () => URL.revokeObjectURL(blob),
  };
};

const flat = (arr, acc, out) => {
  out = out || [];
  arr.map(function (d) {
    const val = acc ? acc(d) : d;
    if (Array.isArray(val)) flat(val, acc, out);
    out.push(d);
  });
  return out;
};

const findComments = (holder, content) => {
  const regx = new RegExp(content);
  const commnets = [];
  const iterator = document.createNodeIterator(
    holder,
    NodeFilter.SHOW_COMMENT,
    filterNone,
    false
  );
  let comment;
  while ((comment = iterator.nextNode())) {
    if (regx.test(comment.nodeValue)) commnets.push(comment);
  }

  function filterNone() {
    return NodeFilter.FILTER_ACCEPT;
  }

  return commnets;
};

const deffer = (() => {
  let timeout;
  return (fun) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(fun, 0);
  };
})();

// --------------------------------------

export { Component, Element, addState };
