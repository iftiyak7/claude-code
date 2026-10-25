jQuery(function ($) {
	// Tabs, remembering the last one opened.
	function openTab(hash) {
		var $link = $('.nsl-tab-nav a[href="' + hash + '"]');
		if (!$link.length) return;
		$('.nsl-tab-nav a').removeClass('active');
		$link.addClass('active');
		$('.nsl-panel').removeClass('active');
		$(hash).addClass('active');
		try { localStorage.setItem('nslTab', hash); } catch (e) {}
	}
	$('.nsl-tab-nav a').on('click', function (e) {
		e.preventDefault();
		openTab($(this).attr('href'));
	});
	try { openTab(localStorage.getItem('nslTab') || ''); } catch (e) {}

	$('.nsl-color').wpColorPicker();

	// Media library picker.
	$(document).on('click', '.nsl-image-pick', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nsl-image');
		var frame = wp.media({ title: 'ছবি বাছুন', multiple: false, library: { type: 'image' } });
		frame.on('select', function () {
			var a = frame.state().get('selection').first().toJSON();
			var thumb = (a.sizes && a.sizes.thumbnail) ? a.sizes.thumbnail.url : a.url;
			$wrap.find('input').val(a.id);
			$wrap.find('img').attr('src', thumb).removeClass('hidden');
		});
		frame.open();
	});
	$(document).on('click', '.nsl-image-clear', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nsl-image');
		$wrap.find('input').val('');
		$wrap.find('img').attr('src', '').addClass('hidden');
	});
});
