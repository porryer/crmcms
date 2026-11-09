import { mountList, pageHead } from '../list.js';
import { $ } from '../state.js';

// ======================= 任务 =======================
export async function pageTasks(r) {
  const tabs = [['全部', {}], ['待处理', { status: '待处理' }], ['进行中', { status: '进行中' }], ['已完成', { status: '已完成' }], ['已逾期', { overdue: '1' }], ['今日/逾期', { due: '1' }]];
  const idx = r.params.get('view') === 'due' ? 5 : 0;
  $('#content').innerHTML = pageHead('跟进任务', '任务列表、提醒与完成状态') + '<div id="listHost"></div>';
  await mountList($('#listHost'), 'tasks', { tabs, tab: idx, q: r.params.get('q') || '' });
}
