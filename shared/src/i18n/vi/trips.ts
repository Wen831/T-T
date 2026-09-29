import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} đã bị xóa',
  'trips.memberRemoveError': 'Không thể xóa',
  'trips.memberAdded': '{username} đã thêm',
  'trips.memberAddError': 'Không thể thêm',
  'trips.reminder': 'Lời nhắc nhở',
  'trips.reminderNone': 'Không có',
  'trips.reminderDay': 'ngày',
  'trips.reminderDays': 'ngày',
  'trips.reminderCustom': 'Tùy chọn',
  'trips.reminderDaysBefore': 'ngày trước khi khởi hành',
  'trips.reminderDisabledHint': 'Lời nhắc chuyến đi bị tắt. Kích hoạt chúng trong Quản trị > Cài đặt > Thông báo.',
  'trips.importTrekTab': 'Nhập từ TREK',
  'trips.importTrekIntro':
    'Tải lên bản sao lưu TREK (.zip) và chọn các chuyến đi để sao vào TT — ngày, địa điểm, đặt chỗ, ngân sách và ảnh đều đi cùng.',
  'trips.importTrekPick': 'Chọn bản sao lưu TREK (.zip)',
  'trips.importTrekScanning': 'Đang đọc bản sao lưu…',
  'trips.importTrekImport': 'Nhập các chuyến đi đã chọn',
  'trips.importTrekSuccess': 'Imported {count} trip(s)',
  'trips.importTrekNone': 'Không tìm thấy chuyến đi nào trong bản sao lưu này',
  'trips.importTrekFailed': 'Nhập thất bại. Đây có phải tệp sao lưu TREK không?',
  'trips.importTrekStats': '{days} days · {places} places · {photos} photos · {budget} budget items',
  'trips.importTrekUntitled': 'Chuyến đi không tên',
};
export default trips;
