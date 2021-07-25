import { Component } from './index.js';

export const Element = function (name, render) {
  this.name = name;
  this.instances = [];
  this.render = async (arrAttrs, content) => {
    const attrs = arrToAttrs(arrAttrs);
    const result = render ? await render(attrs, content) : null;
    const isComp = result instanceof Component;
    return isComp ? result : new Component({}, result);
  };
  this.elements.push(this);
};

Element.prototype.add = function (strAttrs, content) {
  const { name, instances } = this;
  const now = Date.now();
  const count = instances.length;
  const id = `--spicyElement:${name}-${now}-${count}--`;
  const attrs = strToAttrs(strAttrs);
  const holder = `<!--${id}-->`;
  const instance = { id, attrs, content, holder };
  instance.render = async (attrs, content) => {
    const comp = await this.render(attrs, content);
    const component = await comp.mount;
    const { nodes } = component;
    if (!nodes.length) await component.add(holder);
    return component;
  };
  instances.push(instance);
  return instance;
};

Element.prototype.elements = [];

// --------------------------------------
// Defaults

new Element('component', ({ path }, content) => {
  const component = new Component({ path }, content);
  return component.mount;
});

new Element('each', ({ values }, cont) => {
  const regx = /\{ *(.+) *\}/g;
  const content = values
    .map((_, i) => cont.replace(regx, `{ values[${i}].$1 }`))
    .join('\n');
  const component = new Component({ values }, content);
  return component.mount;
});

new Element('if', ({ value }, content) => (value ? content : ''));

// --------------------------------------

const strToAttrs = (str) => {
  const matches = str.matchAll(/([^=]+)="([^"]*)"/g);
  return Array.from(matches)
    .map((d) => d.map((dd) => dd.trim()))
    .map(([_, name, value]) => ({ name, value }));
};

const arrToAttrs = (arr, key = 'result') => {
  return arr.reduce((out, d) => {
    return { ...out, [d.name]: d[key] || d.value };
  }, {});
};
