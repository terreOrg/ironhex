(() => {
class MechToggle extends HTMLElement {
  static get observedAttributes() { return ['checked', 'disabled', 'label']; }
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML = `
      <style>
        :host{display:inline-block;width:var(--toggle-width,160px);vertical-align:middle;flex-shrink:0;container-type:inline-size;-webkit-tap-highlight-color:transparent}
        *{box-sizing:border-box}
        button{position:relative;display:block;width:100%;aspect-ratio:160/270;padding:0;border:2px solid #626969;border-radius:clamp(4px,9cqi,14px);color:#e1e3d9;background:repeating-linear-gradient(95deg,#ffffff02 0 1px,transparent 1px 4px),linear-gradient(115deg,#434b4d,#262e30 45%,#353b3d);box-shadow:inset 0 0 0 4px #161c1e,inset 0 0 0 5px #62696955,0 8px 14px #0006;cursor:pointer;touch-action:manipulation}
        button:focus-visible{outline:3px solid #edbb6d;outline-offset:2px}button:disabled{cursor:not-allowed;filter:saturate(.2);opacity:.5}
        .screw{position:absolute;width:10%;aspect-ratio:1;border-radius:50%;background:linear-gradient(120deg,#a6abaa,#303737 60%);box-shadow:0 1px 3px #000,inset 0 0 0 2px #151b1c}.screw:after{content:'';position:absolute;width:60%;height:16%;background:#131819;top:42%;left:20%;transform:rotate(-30deg)}
        .s1{left:9%;top:6%}.s2{right:9%;top:6%}.s3{left:9%;bottom:6%}.s4{right:9%;bottom:6%}
        .mark{position:absolute;left:0;right:0;font:bold 25px/1 system-ui;font-size:clamp(7px,13cqi,25px);color:#9a9e96}.on{top:12%}.off{bottom:12%;color:#e8e7dc}
        .led{position:absolute;width:5%;aspect-ratio:1;left:47.5%;top:6%;border-radius:50%;background:#413c30;box-shadow:0 0 0 2px #111a1c}
        .collar{position:absolute;width:61%;aspect-ratio:1;left:19.5%;top:32%;border-radius:50%;background:conic-gradient(#b7bcb8,#525b59,#cad0c8,#626b67,#b7bcb8);box-shadow:0 4px 7px #0009,inset 0 0 0 3px #b9c0b455}
        .socket{position:absolute;inset:15%;border-radius:50%;background:radial-gradient(ellipse,#030708 30%,#121b1e 60%,#717b76 63%,#272e2e 72%)}
        .pivot{position:absolute;width:24%;height:13%;left:38%;top:44%;border-radius:40%;background:linear-gradient(90deg,#444e50,#adb4ad 45%,#495558);box-shadow:0 3px 5px #000}
        .lever{position:absolute;left:39%;top:22%;width:22%;height:31%;transform-origin:50% 94%;transform:rotateX(180deg);transition:transform 180ms ease-in-out;filter:drop-shadow(3px 3px 2px #0008)}
        .shaft{position:absolute;left:25%;top:35%;width:50%;height:65%;border-radius:3px;background:linear-gradient(90deg,#5a6768,#d3d9ce 40%,#87928c 65%,#3c494b)}
        .grip{position:absolute;inset:0 0 37%;border-radius:45% 45% 25% 25%;background:repeating-linear-gradient(0deg,transparent 0 9%,#0007 10% 12%,#ffffff10 13% 15%),linear-gradient(90deg,#111719,#404848 42%,#151d20);border:1px solid #111b1d;box-shadow:inset 1px 2px 2px #ffffff22}
        :host([checked]) .lever{transform:rotateX(0deg)}:host([checked]) .on{color:#f0d5a2}:host([checked]) .off{color:#868c88}:host([checked]) .led{background:#eac17b;box-shadow:0 0 0 2px #111a1c,0 0 9px #edb657aa}
        @media(prefers-reduced-motion:reduce){.lever{transition:none}}
      </style>
      <button type="button" role="switch" aria-checked="false">
        <span aria-hidden="true"><i class="screw s1"></i><i class="screw s2"></i><i class="screw s3"></i><i class="screw s4"></i><i class="led"></i><span class="mark on">I</span><span class="mark off">O</span><span class="collar"><span class="socket"></span></span><span class="pivot"></span><span class="lever"><span class="shaft"></span><span class="grip"></span></span></span>
      </button>`;
    this._button = this.shadowRoot.querySelector('button');
    this._button.addEventListener('click', () => {
      if (this.disabled) return;
      this.checked = !this.checked;
      this.dispatchEvent(new CustomEvent('change', {
        detail: {checked: this.checked}, bubbles: true, composed: true
      }));
    });
  }
  connectedCallback() {
    for (const prop of ['checked', 'disabled']) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop]; delete this[prop]; this[prop] = value;
      }
    }
    this._sync();
  }
  attributeChangedCallback() { this._sync(); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(value) { this.toggleAttribute('checked', Boolean(value)); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  _sync() {
    if (!this._button) return;
    this._button.setAttribute('aria-checked', String(this.checked));
    this._button.setAttribute('aria-label', this.getAttribute('label') || 'Тумблер');
    this._button.disabled = this.disabled;
  }
}
if (!customElements.get('mech-toggle')) customElements.define('mech-toggle', MechToggle);
})();
