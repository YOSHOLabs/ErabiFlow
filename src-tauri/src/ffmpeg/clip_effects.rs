use super::escaping::escape_filter_path;

pub(super) fn to_ffmpeg_color(css: &str) -> String {
    if css.starts_with('#') && css.len() >= 7 {
        return format!("0x{}", &css[1..]);
    }
    if css.starts_with("rgba(") {
        let inner = css.trim_start_matches("rgba(").trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 4 {
            let r: u8 = parts[0].trim().parse().unwrap_or(0);
            let g: u8 = parts[1].trim().parse().unwrap_or(0);
            let b: u8 = parts[2].trim().parse().unwrap_or(0);
            let a: f64 = parts[3].trim().parse().unwrap_or(1.0);
            return format!("0x{:02X}{:02X}{:02X}@{:.2}", r, g, b, a);
        }
        return "black".to_string();
    }
    if css.starts_with("rgb(") {
        let inner = css.trim_start_matches("rgb(").trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 3 {
            let r: u8 = parts[0].trim().parse().unwrap_or(0);
            let g: u8 = parts[1].trim().parse().unwrap_or(0);
            let b: u8 = parts[2].trim().parse().unwrap_or(0);
            return format!("0x{:02X}{:02X}{:02X}", r, g, b);
        }
    }
    css.to_string()
}

pub(super) fn build_audio_effect_filter(
    effects: &Option<crate::ClipAudioEffects>,
    duration: f64,
) -> String {
    let Some(effects) = effects.as_ref() else {
        return String::new();
    };
    let mut filter = String::new();
    for (frequency, gain) in [
        (100, effects.eq_low),
        (1000, effects.eq_mid),
        (8000, effects.eq_high),
    ] {
        if gain.abs() > 0.01 {
            filter.push_str(&format!(
                ",equalizer=f={frequency}:t=q:w=1:g={:.2}",
                gain.clamp(-20.0, 20.0)
            ));
        }
    }
    if effects.noise_reduction > 0.01 {
        let floor = -80.0 + effects.noise_reduction.clamp(0.0, 100.0) * 0.60;
        filter.push_str(&format!(",afftdn=nf={floor:.2}"));
    }
    if effects.normalize {
        filter.push_str(",loudnorm=I=-16:LRA=11:TP=-1.5");
    }
    let fade_in = effects.fade_in.clamp(0.0, duration);
    let fade_out = effects.fade_out.clamp(0.0, duration);
    if fade_in > 0.001 {
        filter.push_str(&format!(",afade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out > 0.001 {
        filter.push_str(&format!(
            ",afade=t=out:st={:.3}:d={fade_out:.3}",
            (duration - fade_out).max(0.0)
        ));
    }
    filter
}

pub(super) fn build_color_filter(color: &Option<crate::ClipColorAdjustments>) -> String {
    let Some(color) = color.as_ref() else {
        return String::new();
    };
    let brightness = (color.brightness / 100.0).clamp(-1.0, 1.0);
    let contrast = (color.contrast / 100.0).clamp(0.0, 2.0);
    let saturation = ((color.saturation / 100.0)
        * (1.0 + color.hsl_saturation.clamp(-100.0, 100.0) / 100.0))
        .clamp(0.0, 4.0);
    let warmth = (color.temperature / 1000.0).clamp(-0.1, 0.1);
    let tint = (color.tint / 1000.0).clamp(-0.1, 0.1);
    let tone = |x: f64, adjustment: f64, curve: f64| {
        (((x - 0.5) * contrast + 0.5 + brightness)
            + adjustment.clamp(-100.0, 100.0) * 0.0025
            + curve.clamp(-100.0, 100.0) * 0.0020)
            .clamp(0.0, 1.0)
    };
    let black = tone(0.0, color.blacks, 0.0);
    let shadow = tone(0.25, color.shadows, color.curve_shadows);
    let middle = tone(0.5, color.lightness, color.curve_midtones);
    let highlight = tone(0.75, color.highlights, color.curve_highlights);
    let white = tone(1.0, color.whites, 0.0);
    let mut filter = format!(
        ",curves=all='0/{black:.6} 0.25/{shadow:.6} 0.5/{middle:.6} 0.75/{highlight:.6} 1/{white:.6}',hue=h={:.3}:s={saturation:.6},colorbalance=rs={warmth:.6}:gs={:.6}:bs={:.6}",
        color.hue.clamp(-180.0, 180.0), -tint, -warmth
    );
    if let Some(path) = color
        .lut_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        filter.push_str(&format!(",lut3d=file='{}'", escape_filter_path(path)));
    }
    filter
}

pub(super) fn build_visual_effect_filter(effects: &Option<crate::ClipVisualEffects>) -> String {
    let Some(effects) = effects.as_ref() else {
        return String::new();
    };
    let mut filter = String::new();
    if effects.blur > 0.001 {
        filter.push_str(&format!(
            ",gblur=sigma={:.3}:steps=2",
            effects.blur.clamp(0.0, 50.0)
        ));
    }
    if effects.mosaic >= 2.0 {
        let pixel = effects.mosaic.clamp(2.0, 50.0).round() as u32;
        filter.push_str(&format!(
            ",scale=iw/{pixel}:ih/{pixel},scale=iw*{pixel}:ih*{pixel}:flags=neighbor"
        ));
    }
    if effects.motion_blur > 0.001 {
        let frames = (2.0 + effects.motion_blur.clamp(0.0, 100.0) / 20.0).round() as usize;
        filter.push_str(&format!(",tmix=frames={frames}"));
    }
    if effects.sharpen > 0.001 {
        filter.push_str(&format!(
            ",unsharp=5:5:{:.3}:5:5:0",
            effects.sharpen.clamp(0.0, 100.0) / 55.0
        ));
    }
    if effects.noise > 0.001 {
        filter.push_str(&format!(
            ",noise=alls={:.2}:allf=t",
            effects.noise.clamp(0.0, 100.0) / 5.0
        ));
    }
    if effects.vhs > 0.001 {
        let amount = effects.vhs.clamp(0.0, 100.0);
        filter.push_str(&format!(",rgbashift=rh={:.2}:bh={:.2},noise=alls={:.2}:allf=t,drawgrid=w=iw:h=5:t=1:c=black@{:.3}", amount / 25.0, -amount / 25.0, amount / 8.0, amount / 500.0));
    }
    if effects.film > 0.001 {
        let amount = effects.film.clamp(0.0, 100.0);
        filter.push_str(&format!(
            ",noise=alls={:.2}:allf=t,vignette=PI/{:.3}",
            amount / 10.0,
            3.0 + amount / 40.0
        ));
    }
    if effects.glitch > 0.001 {
        let amount = effects.glitch.clamp(0.0, 100.0);
        filter.push_str(&format!(
            ",rgbashift=rh={:.2}:rv={:.2}:bh={:.2}:bv={:.2},noise=alls={:.2}:allf=t",
            amount / 15.0,
            amount / 30.0,
            -amount / 15.0,
            -amount / 30.0,
            amount / 12.0
        ));
    }
    let rgb = (effects.rgb_shift + effects.chromatic_aberration).clamp(0.0, 200.0);
    if rgb > 0.001 {
        filter.push_str(&format!(
            ",rgbashift=rh={:.2}:bh={:.2}",
            rgb / 22.0,
            -rgb / 22.0
        ));
    }
    if effects.glow > 0.001 {
        filter.push_str(&format!(
            ",gblur=sigma={:.3}:steps=1",
            effects.glow.clamp(0.0, 100.0) / 35.0
        ));
    }
    if effects.light_leak > 0.001 {
        let amount = effects.light_leak.clamp(0.0, 100.0) / 800.0;
        filter.push_str(&format!(
            ",colorbalance=rh={amount:.4}:gh={:.4}:bh={:.4}",
            amount * 0.45,
            -amount * 0.35
        ));
    }
    if effects.lens_flare > 0.001 {
        filter.push_str(&format!(
            ",vignette=PI/{:.3}:mode=backward",
            2.0 + effects.lens_flare.clamp(0.0, 100.0) / 35.0
        ));
    }
    let weather = (effects.rain + effects.snow + effects.particles).clamp(0.0, 300.0);
    if weather > 0.001 {
        filter.push_str(&format!(",noise=alls={:.2}:allf=t", weather / 30.0));
    }
    if effects.rain > 0.001 {
        filter.push_str(&format!(
            ",drawgrid=w=37:h=ih:t=1:c=lightblue@{:.3}",
            effects.rain.clamp(0.0, 100.0) / 650.0
        ));
    }
    if effects.fire > 0.001 {
        let amount = effects.fire.clamp(0.0, 100.0) / 700.0;
        filter.push_str(&format!(
            ",colorbalance=rs={amount:.4}:gs={:.4}:bs={:.4},noise=alls={:.2}:allf=t",
            amount * 0.35,
            -amount * 0.55,
            effects.fire / 15.0
        ));
    }
    if effects.shake > 0.001 {
        let amount = effects.shake.clamp(0.0, 100.0) / 900.0;
        filter.push_str(&format!(
            ",rotate='{amount:.6}*sin(t*47)':ow=iw:oh=ih:c=black@0"
        ));
    }
    if effects.warp > 0.001 {
        let amount = effects.warp.clamp(0.0, 100.0) / 500.0;
        filter.push_str(&format!(
            ",lenscorrection=k1={amount:.5}:k2={:.5}",
            -amount * 0.35
        ));
    }
    if effects.chroma.enabled {
        let color = to_ffmpeg_color(&effects.chroma.color);
        let similarity = (effects.chroma.similarity / 100.0).clamp(0.01, 1.0);
        let blend = (effects.chroma.blend / 100.0).clamp(0.0, 1.0);
        filter.push_str(&format!(",chromakey={color}:{similarity:.4}:{blend:.4}"));
    }
    let mask = &effects.mask;
    if mask.shape == "ellipse" || mask.shape == "rectangle" {
        let x = mask.x.clamp(0.0, 1.0);
        let y = mask.y.clamp(0.0, 1.0);
        let width = mask.width.clamp(0.01, 1.0);
        let height = mask.height.clamp(0.01, 1.0);
        let alpha = if mask.shape == "ellipse" {
            format!("if(lte(pow((X-W*{x:.6})/(W*{:.6}),2)+pow((Y-H*{y:.6})/(H*{:.6}),2),1),alpha(X,Y),0)", width / 2.0, height / 2.0)
        } else {
            format!(
                "if(between(X,W*{:.6},W*{:.6})*between(Y,H*{:.6},H*{:.6}),alpha(X,Y),0)",
                x - width / 2.0,
                x + width / 2.0,
                y - height / 2.0,
                y + height / 2.0
            )
        };
        filter.push_str(&format!(
            ",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha}'"
        ));
        if mask.feather > 0.001 {
            filter.push_str(&format!(
                ",gblur=sigma={:.3}:planes=8",
                (mask.feather / 5.0).clamp(0.1, 20.0)
            ));
        }
    }
    filter
}

#[cfg(test)]
mod tests {
    use super::{build_audio_effect_filter, build_color_filter, to_ffmpeg_color};

    #[test]
    fn translates_css_colors_without_filter_delimiters() {
        assert_eq!(to_ffmpeg_color("rgba(1, 2, 3, 0.5)"), "0x010203@0.50");
        assert_eq!(to_ffmpeg_color("rgb(255, 128, 0)"), "0xFF8000");
    }

    #[test]
    fn empty_effect_options_do_not_modify_the_graph() {
        assert!(build_audio_effect_filter(&None, 10.0).is_empty());
        assert!(build_color_filter(&None).is_empty());
    }
}
