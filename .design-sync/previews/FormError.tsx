import { Button, FormError } from "yazy-battle-ui";

export const InForm = () => (
  <section className="account-panel" style={{ width: 400 }}>
    <label className="profile-field">
      <span>你想用什麼名字</span>
      <input defaultValue="" />
    </label>
    <FormError>先取一個玩家名稱吧。</FormError>
    <Button>開一桌</Button>
  </section>
);

export const Alone = () => (
  <div style={{ width: 360 }}>
    <FormError>帳號或密碼不對，再試一次。</FormError>
  </div>
);
