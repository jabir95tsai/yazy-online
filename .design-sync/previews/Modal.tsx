import { Button, Modal } from "yazy-battle-ui";

export const ConfirmSurrender = () => (
  <Modal label="確認投降" onClose={() => {}}>
    <h2>確定要投降？</h2>
    <p>投降後本局判負，保留已得分數，無法再擲骰。其他玩家可以繼續挑戰分數紀錄。</p>
    <div className="results-actions">
      <Button variant="ghost">繼續玩</Button>
      <Button>確認投降</Button>
    </div>
  </Modal>
);
