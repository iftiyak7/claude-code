jQuery(function ($) {
	// Tabs, remembering the last one opened.
	function openTab(hash) {
		var $link = $('.nmo-tab-nav a[href="' + hash + '"]');
		if (!$link.length) return;
		$('.nmo-tab-nav a').removeClass('active');
		$link.addClass('active');
		$('.nmo-panel').removeClass('active');
		$(hash).addClass('active');
		try { localStorage.setItem('nmoTab', hash); } catch (e) {}
	}
	$('.nmo-tab-nav a').on('click', function (e) {
		e.preventDefault();
		openTab($(this).attr('href'));
	});
	try { openTab(localStorage.getItem('nmoTab') || ''); } catch (e) {}

	$('.nmo-color').wpColorPicker();

	// Media library picker.
	$(document).on('click', '.nmo-image-pick', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nmo-image');
		var frame = wp.media({ title: 'ছবি বাছুন', multiple: false, library: { type: 'image' } });
		frame.on('select', function () {
			var a = frame.state().get('selection').first().toJSON();
			var thumb = (a.sizes && a.sizes.thumbnail) ? a.sizes.thumbnail.url : a.url;
			$wrap.find('input').val(a.id);
			$wrap.find('img').attr('src', thumb).removeClass('hidden');
		});
		frame.open();
	});
	$(document).on('click', '.nmo-image-clear', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nmo-image');
		$wrap.find('input').val('');
		$wrap.find('img').attr('src', '').addClass('hidden');
	});
});
